"""Exercise the actual signed runner's certificate path without a VPS or Docker.

OpenSSL uses a temporary test CA only in this test process. Production keeps its
system trust store; no trust settings, ACME endpoint or remote host are changed.
"""
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
if sys.platform == "win32":
    sys.modules["fcntl"] = types.ModuleType("fcntl")
BUNDLE = pathlib.Path(__file__).resolve().parents[1] / "resources/server-installer/v1"
spec = importlib.util.spec_from_file_location("installer_tls", BUNDLE / "runner.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class CertificateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="meetspace-tls-test-")
        cls.fixture = pathlib.Path(cls.temporary.name)
        cls.openssl = "/opt/homebrew/opt/openssl@3/bin/openssl" if pathlib.Path("/opt/homebrew/opt/openssl@3/bin/openssl").is_file() else shutil.which("openssl")
        if not cls.openssl:
            raise RuntimeError("OpenSSL is required for meaningful certificate verification")
        def command(*args):
            subprocess.run([cls.openssl, *args], cwd=cls.fixture, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        command("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "2", "-subj", "/CN=Disposable TLS test CA", "-keyout", "ca.key", "-out", "ca.pem", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
        command("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", "/CN=meet.example.com", "-keyout", "leaf.key", "-out", "leaf.csr")
        (cls.fixture / "extensions").write_text("subjectAltName=DNS:meet.example.com\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n")
        command("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2", "-extfile", "extensions", "-out", "leaf.pem")
        command("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAserial", "ca.srl", "-days", "0", "-extfile", "extensions", "-out", "expired.pem")
        command("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", "other.key")
        command("pkcs8", "-topk8", "-in", "leaf.key", "-out", "encrypted.key", "-passout", "pass:disposable-test-password")
        cls.material = {"fullchain": (cls.fixture / "leaf.pem").read_text() + (cls.fixture / "ca.pem").read_text(), "privateKey": (cls.fixture / "leaf.key").read_text()}

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.recipe = json.loads((BUNDLE / "release.json").read_bytes())
        self.options = {"domain": "meet.example.com", "publicIpv4": "8.8.8.8", "acmeEmail": "", "tlsMode": "custom", "certificateSha256": r.digest(self.material["fullchain"].encode())}
        self.original_run = r.run
        self.commands = []

    def run_openssl(self, args, **kwargs):
        self.commands.append(args)
        if args[0] != "openssl":
            raise AssertionError("Unexpected external command in certificate test")
        args = [self.openssl, *args[1:]]
        if args[1] == "verify":
            args[2:2] = ["-CAfile", str(self.fixture / "ca.pem")]
        return self.original_run(args, **kwargs)

    def rejected(self, code, function, *args, **kwargs):
        with self.assertRaises(r.InstallError) as caught:
            function(*args, **kwargs)
        self.assertEqual(code, caught.exception.code)

    def create_plan(self, options):
        with patch.object(r, "platform_facts", return_value={"os": "ubuntu", "osVersion": "24.04", "arch": "arm64", "cpus": 4, "memoryKiB": 8 * 1024 ** 2}), patch.object(r, "managed_marker", return_value=None), patch.object(r, "disk_free", return_value=40 * 1024 ** 3), patch.object(r, "docker_facts", return_value={"installed": False}), patch.object(r, "check_ports"), patch.object(r, "dns_check", return_value=["8.8.8.8"]), patch.object(r.pathlib.Path, "exists", return_value=False):
            return r.create_plan(options, self.recipe, issued_at=100)

    def test_mode_default_preserves_legacy_plan_options_and_custom_binding(self):
        legacy = {"domain": "meet.example.com", "publicIpv4": "8.8.8.8", "acmeEmail": ""}
        self.assertEqual(legacy, r.validate_options(legacy, self.recipe))
        self.assertEqual("letsencrypt", r.tls_mode(legacy))
        custom = self.create_plan(self.options)
        letsencrypt = self.create_plan(legacy)
        self.assertNotEqual(custom["hash"], letsencrypt["hash"])
        self.assertIn("custom-https-wss", custom["actions"])
        self.assertNotIn("acme-https-wss", custom["actions"])
        self.assertIn("custom-certificate-renewal-manual", custom["warnings"])
        self.assertNotIn("turn-restarts-on-certificate-renewal", custom["warnings"])
        self.assertIn("acme-https-wss", letsencrypt["actions"])
        self.assertNotIn("BEGIN", r.canonical(custom).decode())

    def test_mode_and_metadata_fail_closed(self):
        for mode in (None, "", "auto", 123, True, {}):
            self.rejected("INVALID_TLS", r.validate_options, dict(self.options, tlsMode=mode), self.recipe)
        for changes in ({"certificateSha256": "A" * 64}, {"certificateSha256": "abc"}, {"acmeEmail": "someone@example.com"}):
            self.rejected("INVALID_TLS", r.validate_options, dict(self.options, **changes), self.recipe)
        self.rejected("INVALID_TLS", r.validate_options, dict(self.options, tlsMode="letsencrypt"), self.recipe)
        self.rejected("INVALID_REQUEST", r.validate_options, dict(self.options, privateKey=self.material["privateKey"]), self.recipe)
        legacy_recipe = dict(self.recipe)
        legacy_recipe.pop("tlsPolicy", None)
        self.rejected("INVALID_TLS", r.validate_options, self.options, legacy_recipe)

    def test_actual_openssl_accepts_matching_chain_and_checks_all_bindings(self):
        with patch.object(r, "run", side_effect=self.run_openssl):
            data = r.validate_tls_certificate(self.material, self.options)
        self.assertEqual(self.material["fullchain"].encode(), data["fullchain"])
        self.assertEqual(self.material["privateKey"].encode(), data["privateKey"])
        self.assertTrue(any(args[1] == "verify" for args in self.commands))
        self.assertFalse(any(self.material["privateKey"] in str(arg) for args in self.commands for arg in args))
        with patch.object(r, "run", side_effect=self.run_openssl):
            self.rejected("CERTIFICATE_DOMAIN", r.validate_tls_certificate, self.material, dict(self.options, domain="other.example.com"))
            self.rejected("CERTIFICATE_KEY_MISMATCH", r.validate_tls_certificate, dict(self.material, privateKey=(self.fixture / "other.key").read_text()), self.options)
            expired = dict(self.material, fullchain=(self.fixture / "expired.pem").read_text() + (self.fixture / "ca.pem").read_text())
            self.rejected("CERTIFICATE_EXPIRED", r.validate_tls_certificate, expired, dict(self.options, certificateSha256=r.digest(expired["fullchain"].encode())))

    def test_untrusted_chain_is_rejected_without_changing_system_trust(self):
        def real_system(args, **kwargs):
            return self.original_run([self.openssl, *args[1:]], **kwargs)
        with patch.object(r, "run", side_effect=real_system):
            self.rejected("CERTIFICATE_UNTRUSTED", r.validate_tls_certificate, self.material, self.options)

    def test_private_payload_validation_is_bounded_and_does_not_log(self):
        self.rejected("CERTIFICATE_REQUIRED", r.validate_tls_certificate, None, self.options)
        self.rejected("CERTIFICATE_REQUIRED", r.validate_tls_certificate, dict(self.material, unexpected="secret"), self.options)
        self.rejected("CERTIFICATE_CHANGED", r.validate_tls_certificate, self.material, dict(self.options, certificateSha256="0" * 64))
        for material in (dict(self.material, privateKey="x" * 16385), dict(self.material, fullchain="x" * 65537), dict(self.material, privateKey="\ud800"), dict(self.material, privateKey=(self.fixture / "encrypted.key").read_text())):
            self.rejected("CERTIFICATE_INVALID", r.validate_tls_certificate, material, self.options)
        corrupted = dict(self.material, fullchain=self.material["fullchain"] + "PRIVATE DATA")
        self.rejected("CERTIFICATE_INVALID", r.validate_tls_certificate, corrupted, dict(self.options, certificateSha256=r.digest(corrupted["fullchain"].encode())))
        self.rejected("INVALID_TLS", r.validate_tls_certificate, self.material, {"tlsMode": "letsencrypt"})

    def test_secrets_rejected_on_every_non_apply_control_action(self):
        for action in ("plan", "status", "cancel", "resume"):
            with patch.object(r.os, "geteuid", return_value=0), patch.object(r, "load_bundle") as bundle, patch.object(r.os, "umask"):
                self.rejected("INVALID_REQUEST", r.main, action, {"tlsCertificate": self.material})
                bundle.assert_not_called()

    def test_invalid_apply_has_no_lock_or_host_state_mutation(self):
        plan = self.create_plan(self.options)
        with patch.object(r, "manifest_for_plan", return_value=self.recipe), patch.object(r, "lock_file") as lock, patch.object(r, "initialize_layout") as initialize:
            self.rejected("CERTIFICATE_CHANGED", r.apply, {"plan": plan, "confirmedPlanHash": plan["hash"], "jobId": "e0b0d6f0-14f6-4c58-a674-9c9665465a62", "tlsCertificate": dict(self.material, fullchain=self.material["fullchain"] + "\n")}, self.recipe, {})
            lock.assert_not_called(); initialize.assert_not_called()

    def test_custom_apply_does_not_require_acme_terms_and_le_still_does(self):
        custom = self.create_plan(self.options)
        legacy = self.create_plan({"domain": "meet.example.com", "publicIpv4": "8.8.8.8", "acmeEmail": ""})
        value = "e0b0d6f0-14f6-4c58-a674-9c9665465a62"
        with patch.object(r, "lock_file", return_value=contextlib.nullcontext()), patch.object(r, "managed_marker", return_value=None), patch.object(r.time, "time", return_value=100), patch.object(r, "run", side_effect=self.run_openssl), patch.object(r, "create_plan", return_value=custom), patch.object(r, "initialize_layout") as initialize, patch.object(r, "start_unit"), patch.object(r, "status", return_value={"state": "running"}):
            r.apply({"plan": custom, "confirmedPlanHash": custom["hash"], "jobId": value, "tlsCertificate": self.material, "acceptAcmeTerms": False, "confirmDockerInstall": True}, self.recipe, {})
            self.assertEqual(self.material["privateKey"].encode(), initialize.call_args.args[5]["privateKey"])
        with patch.object(r, "lock_file", return_value=contextlib.nullcontext()), patch.object(r, "managed_marker", return_value=None), patch.object(r.time, "time", return_value=100), patch.object(r, "create_plan", return_value=legacy), patch.object(r, "initialize_layout") as initialize:
            self.rejected("ACME_TERMS_REQUIRED", r.apply, {"plan": legacy, "confirmedPlanHash": legacy["hash"], "jobId": value, "acceptAcmeTerms": False, "confirmDockerInstall": True}, self.recipe, {})
            initialize.assert_not_called()

    def test_existing_jobs_cannot_change_mode_or_certificate(self):
        previous = self.create_plan(self.options)
        for changes in ({"tlsMode": "letsencrypt"}, {"certificateSha256": "a" * 64}):
            candidate = dict(self.options, **changes)
            if candidate["tlsMode"] == "letsencrypt":
                candidate.pop("certificateSha256")
            with patch.object(r, "managed_marker", return_value={"jobId": "e0b0d6f0-14f6-4c58-a674-9c9665465a62"}), patch.object(r, "read_json", return_value=previous), patch.object(r, "manifest_for_plan", return_value=self.recipe), patch.object(r, "create_plan") as create:
                self.rejected("EXISTING_INSTALLATION", r.plan_latest, candidate, self.recipe)
                create.assert_not_called()

    def initialize_custom(self, root):
        value = "e0b0d6f0-14f6-4c58-a674-9c9665465a62"
        plan = self.create_plan(self.options)
        material = {key: text.encode() for key, text in self.material.items()}
        bundle = {name: (BUNDLE / name).read_bytes() for name in ("runner.py", "release.json", "release.sig", "trust-root.pem", "docker.asc")}
        with patch.object(r, "ROOT", root), patch.object(r, "no_symlink"):
            r.initialize_layout(value, plan, self.recipe, bundle, tls_certificate=material)
        return value, plan, root / "jobs" / value

    def test_private_atomic_initialization_and_detached_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "meetspace"
            value, plan, directory = self.initialize_custom(root)
            for name in ("fullchain.pem", "privkey.pem"):
                self.assertEqual(0o600, (directory / "custom-tls" / name).stat().st_mode & 0o777)
            self.assertEqual(0o700, (directory / "custom-tls").stat().st_mode & 0o777)
            self.assertNotIn("PRIVATE KEY", (directory / "plan.json").read_text())
            self.assertNotIn("BEGIN", (directory / "state.json").read_text())
            state = {"state": "needs_recovery"}
            with patch.object(r, "ROOT", root), patch.object(r, "no_symlink"), patch.object(r, "lock_file", return_value=contextlib.nullcontext()), patch.object(r, "run", side_effect=self.run_openssl), patch.object(r, "status", return_value=state), patch.object(r, "unit_active", return_value=False), patch.object(r, "platform_facts", return_value=plan["platform"]), patch.object(r, "dns_check"), patch.object(r, "disk_free", return_value=40 * 1024 ** 3), patch.object(r, "start_unit") as start:
                r.control("resume", {"jobId": value, "planHash": plan["hash"], "confirmedPlanHash": plan["hash"]}, self.recipe)
                start.assert_called_once_with(value)
            (directory / "custom-tls" / "privkey.pem").chmod(0o644)
            with patch.object(r, "no_symlink"):
                self.rejected("CERTIFICATE_INVALID", r.stored_tls_certificate, directory, self.options)

    def test_custom_https_skips_acme_and_preserves_old_tls_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "meetspace"
            _, plan, directory = self.initialize_custom(root)
            (root / "tls").mkdir()
            (root / "tls/fullchain.pem").write_text("previous public certificate")
            (root / "tls/privkey.pem").write_text("previous private key")
            worker = object.__new__(r.Worker)
            worker.directory = directory; worker.options = self.options
            worker.write_nginx = unittest.mock.Mock(); worker.compose = unittest.mock.Mock(); worker.certbot = unittest.mock.Mock(side_effect=AssertionError("Custom mode must not request ACME"))
            with patch.object(r, "ROOT", root), patch.object(r, "no_symlink"), patch.object(r, "run", side_effect=self.run_openssl), patch.object(r.os, "chown"):
                worker.phase_https()
                worker.phase_https()  # interrupted worker retry keeps the first backup
            worker.certbot.assert_not_called()
            self.assertEqual("previous public certificate", (directory / "tls-before-custom/fullchain.pem").read_text())
            self.assertEqual("previous private key", (directory / "tls-before-custom/privkey.pem").read_text())
            self.assertEqual(self.material["privateKey"], (root / "tls/privkey.pem").read_text())
            self.assertEqual(0o640, (root / "tls/privkey.pem").stat().st_mode & 0o777)
            self.assertEqual(0o600, (directory / "tls-before-custom/privkey.pem").stat().st_mode & 0o777)
            self.assertTrue(all(call.kwargs == {"tls": True} for call in worker.write_nginx.call_args_list))
            self.assertFalse(any("certbot" in str(args) or "systemctl" in str(args) for args in self.commands))

    def test_custom_mode_rejects_manual_renew_command(self):
        worker = types.SimpleNamespace(options=self.options)
        with patch.object(r, "Worker", return_value=worker), patch.object(r, "status") as status:
            self.rejected("CUSTOM_CERTIFICATE_MANUAL_RENEWAL", r.renew, "unused", self.recipe)
            status.assert_not_called()

    def test_custom_source_mode_never_pulls_certbot(self):
        worker = object.__new__(r.Worker)
        worker.options = self.options
        worker.manifest = {"builtAt": "2026-10-22T17:41:14Z", "images": {"certbot": "must-not-be-pulled"}}
        with tempfile.TemporaryDirectory() as temporary:
            worker.images_file = pathlib.Path(temporary) / "images.json"
            with patch.object(r, "APP_SERVICES", ()), patch.object(r, "run") as execute:
                worker.phase_images()
                execute.assert_not_called()

    def test_custom_prebuilt_mode_never_pulls_or_inspects_certbot_on_resume(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(r, "no_symlink"), patch.object(r, "state_write"), patch.object(r, "disk_free", return_value=20 * 1024 ** 3):
            root = pathlib.Path(temporary)
            worker = object.__new__(r.Worker)
            worker.directory = root; worker.images_file = root / "images.json"
            worker.options = dict(self.options, imageMode="images")
            worker.manifest = self.recipe
            (root / "prebuilt").mkdir()
            (root / "prebuilt/release").mkdir()
            (root / "prebuilt/release/release.json").write_text("{}")
            archive = root / "prebuilt.tar.gz"; archive.write_bytes(b"fixture")
            worker.plan = {"imageLock": {"sizeBytes": 7, "sha256": r.file_digest(archive), "platform": "linux/arm64"}}
            services = {*r.APP_SERVICES, "postgres", "redis", "rabbitmq", "coturn", "proxy"}
            images = {name: "sha256:" + r.digest(name.encode()) for name in services}
            worker.images_file.write_bytes(r.canonical(images))
            package = {"images": images}
            with patch.object(r, "verify_prebuilt_package", return_value=package), patch.object(r, "verify_prebuilt_labels"), patch.object(worker, "image_details", side_effect=lambda reference: {"Id": reference, "Config": {"Labels": {}}}) as inspect, patch.object(r, "run") as execute:
                worker.phase_images()
                execute.assert_not_called()
                self.assertFalse(any(call.args[0] == self.recipe["images"]["certbot"] for call in inspect.call_args_list))
            self.assertNotIn("certbot", r.read_json(worker.images_file))


if __name__ == "__main__":
    unittest.main()
