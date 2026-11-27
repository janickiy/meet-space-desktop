; NSIS 3.0.4.1 otherwise records mtimes of its temporary archive/uninstaller.
; Loaded before generated license/MUI code, for installer and uninstaller alike.
SetDateSave off

; Show the branded welcome panel for interactive installations only.
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Electron registers meetspace:// for the current user when the app launches.
!macro removeOwnedMeetSpaceProtocol Key Executable
  Push $R0
  ReadRegStr $R0 HKCU "${Key}\shell\open\command" ""
  StrCmp $R0 '"$INSTDIR\${Executable}" "%1"' 0 +2
    DeleteRegKey HKCU "${Key}"
  Pop $R0
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro removeOwnedMeetSpaceProtocol "Software\Classes\meetspace" "${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend
