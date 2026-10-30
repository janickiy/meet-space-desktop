import { api } from "../api";
import { useAuth } from "../auth";
import { AvatarPicker } from "./AvatarPicker";
import { UserAvatar } from "./UserAvatar";

/** Save photos independently from the profile name form. */
export function ProfileAvatarEditor() {
  const { user, updateAvatar } = useAuth();
  return (
    <AvatarPicker
      hasPhoto={Boolean(user?.avatarVersion)}
      onSave={async (file, signal) => {
        await updateAvatar(file, signal);
      }}
      onRemove={async (signal) => {
        await updateAvatar(null, signal);
      }}
      loadCurrent={(signal) => api.userAvatar(user!.id, signal)}
      fallback={
        <UserAvatar
          id={user?.id}
          name={user?.displayName || user?.email || ""}
          version={user?.avatarVersion}
          className=""
        />
      }
    />
  );
}
