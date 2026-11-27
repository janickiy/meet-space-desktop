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

!if "${APP_ID}" == "com.janickiy.meetspace.desktop.test"
!ifndef BUILD_UNINSTALLER
!include LogicLib.nsh
!include Win\COM.nsh

; Some test builds left an extra link untracked by the installer registry.
; Inspect the shell link before touching it, including when its name matches.
Function migrateLegacyMeetSpaceShortcut
  Exch $R0
  ${If} ${FileExists} "$R0\MeetSpace Test.lnk"
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("$R0\MeetSpace Test.lnk",0).r2'
        ${If} $2 = 0
          ${IShellLink::GetPath} $0 '(.r3,${NSIS_MAX_STRLEN},0,0).r2'
          ${If} $2 = 0
            ; The shell can return a long path even when NSIS has an 8.3 path.
            System::Call 'kernel32::GetLongPathNameW(w r3, w .r3, i ${NSIS_MAX_STRLEN}) i.r2'
            System::Call 'kernel32::GetLongPathNameW(w "$INSTDIR\${PRODUCT_FILENAME}.exe", w .r4, i ${NSIS_MAX_STRLEN}) i.r5'
            ${If} $2 > 0
            ${AndIf} $2 < ${NSIS_MAX_STRLEN}
            ${AndIf} $2 = $5
            ${AndIf} $3 == $4
              ${If} ${FileExists} "$R0\${SHORTCUT_NAME}.lnk"
                Delete "$R0\MeetSpace Test.lnk"
              ${Else}
                Rename "$R0\MeetSpace Test.lnk" "$R0\${SHORTCUT_NAME}.lnk"
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
  Pop $R0
FunctionEnd

!macro customInstall
  Push "$SMPROGRAMS"
  Call migrateLegacyMeetSpaceShortcut
  ${IfNot} ${isNoDesktopShortcut}
    Push "$DESKTOP"
    Call migrateLegacyMeetSpaceShortcut
  ${EndIf}
!macroend
!endif
!endif
