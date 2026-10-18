import { ExternalLink } from "./ExternalLink";

/** Показывает единый копирайт со ссылкой на сайт автора. */
export function Copyright() {
  return (
    <p className="copyright">
      © 2026{" "}
      <ExternalLink href="https://janickiy.com/">
        Яницкий Александр
      </ExternalLink>
      . Все права защищены.
    </p>
  );
}
