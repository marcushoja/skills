#!/usr/bin/env bash
# Vorlage für einen Diagnoseablauf mit manuellen Schritten.
# Kopiere die Datei, passe den markierten Abschnitt an und starte die Kopie
# mit Bash in einem interaktiven Terminal. Die Ausgabe enthält die erfassten
# Beobachtungen als SCHLÜSSEL=WERT. Keine Zugangsdaten erfassen; das Anmelden
# ist bei Bedarf ein Schritt, keine Eingabe in dieses Skript.

set -euo pipefail

step() {
  printf '\n>>> %s\n    [Weiter mit Enter] ' "$1" >&2
  read -r _
}

capture() {
  local variable="$1" question="$2" answer
  printf '\n>>> %s\n    > ' "$question" >&2
  IFS= read -r answer
  printf -v "$variable" '%s' "$answer"
}

# --- Beispielschritte anpassen ------------------------------------------

step "Öffne die Anwendung unter http://localhost:3000 und melde dich an."
capture ERRORED "Klicke auf „Exportieren“. Ist ein Fehler aufgetreten? (j/n)"
capture ERROR_MSG "Gib die bereinigte Fehlermeldung ein (oder „keine“):"

# --- Ende der Beispielschritte ------------------------------------------

printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
