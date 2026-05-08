; Custom NSIS hooks for the Waterboys installer.

; Runs at installer startup, before electron-builder's in-use file check.
; Electron sometimes leaves orphan GPU/renderer/utility helpers alive after
; a main-process crash; Task Manager's default tab hides them, so the user
; can't see what to kill. taskkill /T cleans the whole process tree.
!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM Waterboys.exe /T'
  Sleep 500
!macroend

; Same idea, but for the uninstaller path: lets the user run
; "Uninstall Waterboys" without first having to quit the running app.
!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM Waterboys.exe /T'
  Sleep 500
!macroend

; Additive uninstall cleanup: clear Electron's singleton-instance lock files
; so re-installs after an uninstall don't trip the "already running" check.
!macro customUnInstall
  Delete "$APPDATA\Waterboys\SingletonLock"
  Delete "$APPDATA\Waterboys\SingletonCookie"
  Delete "$APPDATA\Waterboys\SingletonSocket"
!macroend
