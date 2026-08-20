!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM "${MAINBINARYNAME}.exe" /T'
!macroend
