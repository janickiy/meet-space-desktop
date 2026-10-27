import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { initials } from "../utils";
import { loadPrivateAvatar } from "../groupAvatarLoader";
import { serviceOrigin } from "../platform/urls";
import "./avatar.css";

/** Render an authenticated profile photo with a fallback and owned object URL. */
export function UserAvatar({
  id,
  name,
  version,
  className = "avatar",
}: {
  id?: string;
  name: string;
  version?: string | null;
  className?: string;
}) {
  const { user } = useAuth();
  const origin = serviceOrigin();
  const identity = JSON.stringify([origin, user?.id, id, version]);
  const [photo, setPhoto] = useState<{ identity: string; url: string }>();
  const avatar = useQuery({
    queryKey: ["user-avatar", origin, user?.id, id, version],
    enabled: !!id && !!user && !user.guestConferenceId,
    queryFn: async ({ signal }) => {
      try {
        return await loadPrivateAvatar(
          () => api.userAvatar(id!, signal),
          signal,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
    gcTime: 60_000,
  });
  useEffect(() => {
    setPhoto(undefined);
    if (!avatar.data || avatar.isError) return;
    const url = URL.createObjectURL(avatar.data);
    setPhoto({ identity, url });
    return () => URL.revokeObjectURL(url);
  }, [avatar.data, avatar.isError, identity]);
  const url = photo?.identity === identity ? photo.url : undefined;
  return (
    <span className={`user-avatar ${className}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}
