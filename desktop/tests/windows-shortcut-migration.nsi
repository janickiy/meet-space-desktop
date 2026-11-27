; Build with makensis -DFIXTURE_OUTFILE=<absolute-exe-path> and run the EXE on Windows.
; All shortcuts and targets are disposable. Exit 0 means all three cases passed.
Unicode true
SilentInstall silent
Name "MeetSpace shortcut migration acceptance"
OutFile "${FIXTURE_OUTFILE}"
RequestExecutionLevel user
!define APP_ID "com.janickiy.meetspace.desktop.test"
!define PRODUCT_FILENAME "MeetSpace"
!define SHORTCUT_NAME "MeetSpace"
!include "${__FILEDIR__}/../resources/reproducible.nsh"
Section
  InitPluginsDir
  ; GetPath may return the long spelling of this same directory.
  CreateDirectory "$PLUGINSDIR\Shortcut migration fixture"
  GetFullPathName /SHORT $INSTDIR "$PLUGINSDIR\Shortcut migration fixture"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\MeetSpace.exe"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Other.exe"
  CreateDirectory "$INSTDIR\shortcuts"
  CreateShortCut "$INSTDIR\shortcuts\MeetSpace Test.lnk" "$INSTDIR\MeetSpace.exe"
  Push "$INSTDIR\shortcuts"
  Call migrateLegacyMeetSpaceShortcut
  IfFileExists "$INSTDIR\shortcuts\MeetSpace Test.lnk" failedRename
  IfFileExists "$INSTDIR\shortcuts\MeetSpace.lnk" +1 failedRename
  CreateShortCut "$INSTDIR\shortcuts\MeetSpace Test.lnk" "$INSTDIR\MeetSpace.exe"
  Push "$INSTDIR\shortcuts"
  Call migrateLegacyMeetSpaceShortcut
  IfFileExists "$INSTDIR\shortcuts\MeetSpace Test.lnk" failedDelete
  IfFileExists "$INSTDIR\shortcuts\MeetSpace.lnk" +1 failedDelete
  CreateShortCut "$INSTDIR\shortcuts\MeetSpace Test.lnk" "$INSTDIR\Other.exe"
  Push "$INSTDIR\shortcuts"
  Call migrateLegacyMeetSpaceShortcut
  IfFileExists "$INSTDIR\shortcuts\MeetSpace Test.lnk" +1 failedOwnership
  SetErrorLevel 0
  Goto finished
  failedRename:
    SetErrorLevel 11
    Goto finished
  failedDelete:
    SetErrorLevel 12
    Goto finished
  failedOwnership:
    SetErrorLevel 13
  finished:
SectionEnd
