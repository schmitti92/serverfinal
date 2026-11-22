# DOG – Render-first: persistente Raumzustände (P3)

Stand: 22. November 2026. **Nur eine vorbereitete, bisher ungenutzte Schnittstelle.**
Das Live-Spiel benutzt weiterhin Firestore. Es wurde keine Render-Datenbank
angelegt und kein laufender DOG-Raum umgestellt.

## Aktueller Engpass

- Firestore ist heute der dauerhafte Spielspeicher für jede bestätigte DOG-Aktion.
- Der neue Firestore-CAS-Weg vermeidet einen Raum-GET bei geeigneten Zügen.
- Weiterhin verursacht jeder gewöhnliche Zug einen Firestore-Schreibvorgang,
  und der aktive onSnapshot-Listener kann dafür Lesekosten verursachen.
- Render Free hat keine garantierte dauerhafte lokale Festplatte. Ein RAM-only-
  Raumzustand würde laufende Partien beim Neustart verlieren.
- Das vorhandene Render-Workspace besitzt aktuell keine Postgres- oder KV-Datenbank.

## Technische Vorbereitung in diesem Change

- `migrations/20261122_dog_durable_rooms.sql`: Postgres-Tabellen für vollständigen
  privaten Spielstand, eindeutige Aktionsbelege und separate Outbox.
- `dog-postgres-room-store.js`: optional injizierter `pg`-kompatibler Pool,
  keine automatische Netzwerk-/Firebase-Verbindung. Nur bei expliziter
  Integration in den aktiven Hub verwendbar.
- `seedRoom`: eine begonnene Partie kann nur einmal angelegt werden; ein
  abweichender Spielstart darf eine bestehende Partie nicht überschreiben.
- `commitMove`: Postgres-Transaktion mit Zeilensperre (`FOR UPDATE`),
  Autorisierung anhand der aktuellen gespeicherten Teilnehmer, Prüfung der
  DOG-Revisionsnummer und idempotentem Aktionsbeleg. Spielstand + Beleg +
  Benachrichtigung werden in **derselben SQL-Transaktion** gesichert.
- `getRoom`: Neustart-Wiederherstellung aus dem dauerhaften Datenbankzustand.
- `pendingEvents`/`acknowledgeEvent`: nur Nachrichtenzeiger; keine
  gegnerischen Handkarten, verdeckten Stapel oder Gewinnbeträge in der Outbox.
- Gezielt eingeschränkt: keine aktiven Weihnachtsgewinne, kein Spielabschluss,
  keine externen Belohnungs-/Profiltransaktionen. Eine künftige Integration
  muss `authorize` mit verifizierter Firebase-Identität und einen reinen
  DOG-Regel-Reducer bereitstellen.

## Warum derzeit nicht einfach umschalten?

Firestore verwaltet bislang neben dem DOG-Brett auch Lobby, Anwesenheit,
Spielstart, Weihnachtsdorf, Rubbellose, XP und Match-Endergebnis. Zwei
unabhängige Datenbanken können nicht einfach atomar gemeinsam schreiben.
Ein abruptes Umschalten riskierte doppelte Gewinne, verlorene Spielzüge
oder unterschiedliche Zustände bei mehreren Mitspielern.

Ein SQL-Outbox-Ereignis ist außerdem **at-least-once** zustellbar.
Vor einem echten Firebase-Gewinn muss ein eindeutiger Beleg in einer
Firestore-Transaktion eine doppelte Auszahlung verhindern. Diese
Gewinn-Bridge ist noch nicht implementiert.

## Nötige Freigabe vor Aktivierung

1. Kosten und ausreichende Dauerhaftigkeit von Render Postgres klären;
   nicht automatisch kostenpflichtige Dienste anlegen.
2. Postgres-Datenbank anlegen und nur serverseitig die Verbindungsdaten
   bereitstellen; `pg`-Bibliothek anschließend gesondert einbinden.
3. Migration ausschließlich auf der neuen Testdatenbank ausführen.
4. Testkonten-/Testraum-Pilot mit **getrennter** Feature-Flag:
   initiales Firestore-Raum-Backup -> Postgres seed -> private Client-
   Projektion aus Postgres -> WebSocket-Push aus Outbox; kein Wechsel
   innerhalb einer laufenden echten Partie.
5. Parallele Raumaktionen, Karten-Tausch, 7 teilen, Reconnect,
   Render-Neustart, doppelte Requests, konkurrierende Revisionsupdates,
   Rollen-/Teilnehmerentzug und abgelaufene Räume verifizieren.
6. Firestore-Weihnachtsevent und XP erst mit idempotenten
   Auszahlungsbelegen und verifizierter Bridge migrieren.
7. Erst nach paralleler Messung der echten Firestore-Abrechnungslesevorgänge
   pro Partie den alten DOG-Listener und Raum-Write deaktivieren.
8. Sofortiger Rollback für neue Räume auf Firestore muss möglich sein.
   Bereits über Postgres gestartete Räume müssen beim Rollback dort
   wiederhergestellt werden – nie ungesichert zurücküberschreiben.

## Sicherheits- und Betriebsregeln

- Keine privaten Spielzustände, UIDs oder Tokens in Logmeldungen/Outbox.
- Alle Benachrichtigungen werden **nach** dem bestätigten Commit gesendet;
  Teilnehmerdaten werden pro WebSocket getrennt gefiltert.
- Bei Datenbankfehler: Aktion ablehnen, nicht als gespeichert bestätigen.
- Keine dauerhaften Zustände ausschließlich im Render-RAM.
- Veraltete Raum-/Aktionsbelege erst nach Ablauf der gesicherten
  Wiederherstellungs-/Aufbewahrungsfrist entfernen.
- `npm test` meldet zurzeit unabhängige Fehler in anderen Spielen;
  die neuen Offline-Tests müssen zusätzlich gezielt grün sein.
