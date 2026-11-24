; Compile with makensis -DOUTPUT=<exe> uninstall-protocol.nsi, then run on Windows.
; Uses a private test key and never touches the system's meetspace protocol.
Unicode true
Name "MeetSpace protocol ownership test"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SilentInstall silent

!include "..\resources\reproducible.nsh"

Section
  System::Call 'kernel32::GetCurrentProcessId() i.r1'
  StrCpy $1 "Software\MeetSpaceProtocolOwnershipTest-$1"
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001,w r1,i 0,i 0x20019,*p .r0)i.r2'
  StrCmp $2 2 fresh
  StrCmp $2 0 0 +2
    System::Call 'advapi32::RegCloseKey(p r0)'
  SetErrorLevel 2
  Quit
  fresh:
  WriteRegStr HKCU "$1" "" "test"
  StrCpy $INSTDIR "$TEMP\MeetSpace test installation"

  ; Another handler, even with the same executable name, must survive.
  WriteRegStr HKCU "$1\shell\open\command" "" '"$TEMP\Other\MeetSpace.exe" "%1"'
  !insertmacro removeOwnedMeetSpaceProtocol "$1" "MeetSpace.exe"
  ReadRegStr $0 HKCU "$1\shell\open\command" ""
  StrCmp $0 '"$TEMP\Other\MeetSpace.exe" "%1"' +2
    Goto failed

  ; The exact executable can be used by a different command, too.
  WriteRegStr HKCU "$1\shell\open\command" "" '"$INSTDIR\MeetSpace.exe" --alternate "%1"'
  !insertmacro removeOwnedMeetSpaceProtocol "$1" "MeetSpace.exe"
  ReadRegStr $0 HKCU "$1\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\MeetSpace.exe" --alternate "%1"' +2
    Goto failed

  WriteRegStr HKCU "$1\shell\open\command" "" '"$INSTDIR\MeetSpace.exe" "%1"'
  !insertmacro removeOwnedMeetSpaceProtocol "$1" "MeetSpace.exe"
  ClearErrors
  ReadRegStr $0 HKCU "$1" ""
  IfErrors passed
  failed:
    DeleteRegKey HKCU "$1"
    SetErrorLevel 1
    Quit
  passed:
    SetErrorLevel 0
SectionEnd
