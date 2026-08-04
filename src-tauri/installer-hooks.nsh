; Windows default-apps registration.
;
; Tauri's own `fileAssociations` handling (FileAssociation.nsh) writes the ProgID
; and points `Software\Classes\.md` at it. That is enough to appear under
; "Open with", and it is enough to *become* the default on a machine where the
; user has never chosen a Markdown handler — but nothing more:
;
;   * Windows honours `...\Explorer\FileExts\.md\UserChoice` above the class
;     registration, so on any machine that already has an editor for .md the
;     Tauri write is silently ignored.
;   * Settings > Default apps enumerates applications from
;     `Software\RegisteredApplications` -> a `Capabilities` key. Tauri writes
;     neither, so lindo-md does not appear there at all, and the
;     `ms-settings:defaultapps?registeredAppUser=lindo-md` deep link that
;     `src/defaults.rs` opens has nothing to resolve to.
;
; This hook adds the missing half. It deliberately does NOT touch UserChoice:
; that key is hash-protected and enforced by UCPD.sys, forging it is what malware
; does, and the supported path is to send the user to Settings with one click.
;
; `SHELL_CONTEXT` is set by Tauri's installer from the install mode, so these land
; under HKCU for a per-user install and HKLM for a per-machine one.

!define LINDO_CAPABILITIES "Software\lindo-md\Capabilities"

; Must match the `registeredAppUser` value in `src-tauri/src/defaults.rs`.
!define LINDO_REGISTERED_APP "lindo-md"

; Must match `bundle.fileAssociations[].name` in tauri.conf.json.
!define LINDO_PROGID "LindoMd.Markdown"

!macro LindoRegisterExtension EXT
  ; Lets Explorer offer lindo-md under "Open with" even while another app holds
  ; the default, which the bare class registration does not do on its own.
  WriteRegStr SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${LINDO_PROGID}" ""
  WriteRegStr SHELL_CONTEXT "${LINDO_CAPABILITIES}\FileAssociations" "${EXT}" "${LINDO_PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "${LINDO_CAPABILITIES}" "ApplicationName" "lindo-md"
  WriteRegStr SHELL_CONTEXT "${LINDO_CAPABILITIES}" "ApplicationDescription" \
    "A beautiful, offline Markdown viewer."
  WriteRegStr SHELL_CONTEXT "${LINDO_CAPABILITIES}" "ApplicationIcon" \
    "$INSTDIR\${MAINBINARYNAME}.exe,0"

  !insertmacro LindoRegisterExtension ".md"
  !insertmacro LindoRegisterExtension ".markdown"
  !insertmacro LindoRegisterExtension ".mdown"
  !insertmacro LindoRegisterExtension ".mkd"

  ; The entry Settings > Default apps lists us under, and what the deep link
  ; looks up. Written last, so a half-finished registration is never advertised.
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" \
    "${LINDO_REGISTERED_APP}" "${LINDO_CAPABILITIES}"

  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Removed first, so Settings stops offering an app that is going away.
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${LINDO_REGISTERED_APP}"

  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "${LINDO_PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "${LINDO_PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mdown\OpenWithProgids" "${LINDO_PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mkd\OpenWithProgids" "${LINDO_PROGID}"

  ; `DeleteRegKey /ifempty` would leave the Capabilities subtree behind, and this
  ; whole key is ours — nothing else writes under Software\lindo-md.
  DeleteRegKey SHELL_CONTEXT "Software\lindo-md"

  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
