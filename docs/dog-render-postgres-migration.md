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

## P3-Erweiterung: PostgreSQL-Outbox zu privaten DOG-WebSockets

`dog-postgres-private-fanout.js` ist ein weiterer **noch nicht genutzter**
Adapter. Er ersetzt derzeit **nicht** den Firestore-Watcher des Live-Hubs.

- Der Server gibt ausschließlich eine bereits authentifizierte
  `{uid}`-Identität an `subscribe()` weiter; die echte Firebase-ID-Token-
  Prüfung bleibt Aufgabe der bestehenden HTTP-/WebSocket-Grenze.
- Erst nach einem bestätigten SQL-Commit erscheint ein Ereignis in der
  Outbox. `pollOnce()` liest den vollständigen privaten Spielstand erneut
  aus der dauerhaften Datenbank und sendet **pro Spieler getrennt**
  projizierte Daten, nie den Rohspielstand.
- Neue WebSockets werden vor dem initialen Datenbank-GET registriert.
  Revisionsprüfung und pro-Socket-Warteschlange verhindern, dass eine
  verspätete initiale Antwort einen neueren Zug überschreibt.
- Schon zugestellte Revisionen werden pro Verbindung unterdrückt.
  Misslingt eine Zustellung, bleibt der Ereignisverweis bis zur
  Wiederholung unbestätigt. Ein später wiederverbundener Spieler erhält
  den neuesten dauerhaft gespeicherten Zustand.
- Wurde ein Spieler aus dem Raum entfernt, erhält er aus dieser Outbox
  keine weiteren Spielkarten; ungültige Abonnements werden verworfen.
- Die vorhandene `expose()`-Funktion muss bei einer Liveintegration als
  `project()` übergeben werden. Der voreingestellte reine DOG-
  Spielprojektionstest ist **kein** Ersatz für den vollständigen Hub-Raum-
  Nachrichtenvertrag.
- Der Adapter hat absichtlich keinen Scheduler. Timer, mehrere Render-
  Instanzen, Authentisierung, Benachrichtigungen bei Spielerwechseln,
  Firestore-Reward-Settlement und echte Postgres-Transaktionen müssen
  in einer späteren geprüften Integrationsphase folgen.

Keine Einsparung von abgerechneten Firebase-Zugriffen allein durch das
Hinzufügen dieser bisher nicht angebundenen Dateien.

## P4: Firestore-XP-Abschlussbrücke (vorbereitet, noch nicht aktiv)

`dog-postgres-xp-settlement.js` nutzt die ORIGINAL-Berechnung von
`dogCompletedPlayerStats()` für 1–4 reale Teilnehmer, einschließlich der
3-Spieler-Partie ohne vierten Phantomspieler. Dazu werden beim einmaligen
Partieabschluss pro menschlichem Konto die Statistik und die Forschungsstufen
`xp` und `win_xp` gelesen, **in derselben Firestore-Transaktion** neu
berechnet und geschrieben.

Die neue Firestore-Collection `dog_pg_match_settlements_v1` erhält
pro servergenerierter Match-UUID genau **einen** gesicherten Beleg mit
einem SHA-256-Fingerprint des unveränderlichen Auszahlungsergebnisses.
Jede erneute Buchung mit demselben Fingerprint endet ohne zusätzliche
Statistik-/XP-Schreibvorgänge. Abweichende Belege und mögliche
Überschneidungen mit bereits abgeschlossenen Legacy-Partien werden
ausdrücklich zurückgewiesen.

**Absturz-Szenario:**

1. Vorbereitete Schnittstelle: `stageFinalMove()` legt den unveränderlichen
   Gewinnerstand in `dog_room_pending_finishes` ab; der letzte Zug wird noch
   NICHT in den öffentlich sichtbaren Raum übernommen. Die laufende
   Raumzeile bleibt eingefroren, bis alle XP bestätigt sind.
2. `loadPendingMatch()` muss ausschließlich den zuvor serverseitig in
   Postgres gesicherten vollständigen Endstand laden, niemals eine vom
   Browser gesendete Gewinnbehauptung.
3. Eine Firestore-Transaktion liest den Match-Beleg zuerst, danach alle
   nötigen menschlichen Kontodokumente; erst dann schreibt sie sämtliche
   XP-/Statistikdaten und den Beleg atomar.
4. `markComplete()` markiert den **identischen** Endstand in Postgres
   erst nach erfolgreicher Firestore-Transaktion als bestätigt.
5. Stürzt Render vor Schritt 4 ab, bleibt die PG-Arbeit offen. Wiederholtes
   Ausführen sieht den bestehenden Firestore-Beleg und vermerkt den
   Abschluss in PG ohne doppelte XP-/Statistikgutschrift.

**Wichtige Grenzen:**

- Diese Brücke arbeitet vorerst nur für **nicht-saisonale klassische
  DOG-Abschlüsse**. Bei aktivem Weihnachtsevent fehlen noch die gemeinsame
  sichere Auszahlung von Weihnachtslichtern, Rubbellosen, Preisen,
  Jahres-/Eventbelohnungen und Gebäude-/Forschungsboni.
- Die Endzug-/Pending-Transaktion ist als **unbenutzter** PG-Adapter vorbereitet.
  Es wurde keine Datenbank migriert und kein API-/WebSocket-Routing darauf
  umgestellt; die Live-Spielzüge und alle Event-Gewinne bleiben auf Firestore.
- Eine mehrstufige Auszahlungsbrücke darf niemals einen noch nicht
  bestätigten PG-Abschluss als dauerhaft erledigt anzeigen.
- Die Firestore-Receipt-Sammlung selbst wird nur später beim ersten
  produktiv geprüften PG-Partieabschluss angelegt; das bloße Hinzufügen des
  Moduls belastet Firebase nicht.
- Die Research-XP-Berechnung liest die aktuell in Firestore gültigen
  Forschungsstufen beim Abschluss; falls künftig eine genaue
  Spielstart-/Finishing-Zeit-Snapshot-Semantik erforderlich wird, ist dieser
  Zeitbezug zusätzlich zu versionieren und serverseitig zu fixieren.

## P4-Erweiterung: Letzten Spielzug atomar vormerken

`dog-postgres-finalization.js` ergänzt die noch nicht verwendete
Postgres-Basis um drei serverseitige Operationen:

- `stageFinalMove()` verriegelt die aktive Postgres-Raumzeile, prüft
  Mitgliedschaft, Match-ID, DOG-Revisionsstand und Original-Spielregeln
  und speichert den **vollständigen terminalen Spielstand** als
  unveränderlichen Pending-Auftrag. Die öffentlich sichtbare Raumzeile
  und ihre WebSocket-Outbox bleiben dabei unverändert.
- `commitMove()` wurde abgesichert: Solange ein Pending-Finish existiert,
  sind **sämtliche anderen normalen DOG-Züge gesperrt**. Auch mehrere
  gleichzeitig eingelieferte letzte Züge können nicht parallel gewinnen.
- Die Firestore-XP-Brücke nutzt `loadPendingMatch()` und anschließend
  `markComplete()`. Postgres gleicht den gespeicherten SHA-256-Beleg
  erneut ab, markiert die Statistik als erfasst und speichert erst dann
  den finalen Spielstand, den Aktionsbeleg und das WebSocket-Ereignis
  **atomar in einer Postgres-Transaktion**.

Ein erneuter `markComplete()`-Aufruf nach einem erfolgreich committeten
Postgres-Abschluss erkennt denselben Fingerprint und ist harmlos.
Ein Firestore-Fehler lässt den Pending-Auftrag bestehen und unterbindet
einen falschen Gewinnerabschluss.

**Noch nicht produktionsfähig:** Die vollständige Hub-Routenumschaltung,
automatisches Retry/Monitoring offener Pending-Aufträge, neues
Postgres-Provisioning, echte Datenbank-Integrationstests, Session-Auth,
das gemeinsame Weihnachts-/Rubbellos-/Dorfsettlement und der sichere
Rückweg zu Firestore müssen vor dem Aktivieren abgeschlossen sein.
Diese vorbereitete Migration darf keine vorhandene DOG-Partie betreffen.

## P4-Erweiterung: Weihnachtslichter und Rubbellose gemeinsam buchen

Der **noch nicht in Live-Routen verwendete** Adapter
`dog-postgres-christmas-settlement.js` bereitet die einmalige Auszahlung
einzelner DOG-Weihnachtsereignisse **während einer noch laufenden Partie**
vor. Ein späterer verifizierter Postgres-Gewinnjob muss aus dem
authentischen **serverseitigen** Ausgangs- und Folgezustand eines DOG-Zugs
stammen. Er ist niemals eine beliebige Gewinnmeldung aus dem Browser.

- Der Server prüft dieselbe Match-ID, Raum-ID, Spielergruppe und die
  gültige DOG-Revisionsfolge in beiden Zuständen. Unzulässige
  Rücksetzungen, fremde Gutscheinempfänger, erfundene Kategorien und
  negative/zu große Gewinndifferenzen werden vor Firebase abgewiesen.
- Der tatsächliche Gewinn ergibt sich aus der **Differenz** der
  verifizierten Eventzähler `earnedTenths`, `giftCount`,
  `bonusGiftCount` und `scratchCount`. Genau so bucht die bestehende
  DOG-Engine in der Firestore-Transaktion.
- Ein einziger Firestore-Beleg
  `dog_pg_christmas_move_receipts_v1/{matchId}_{actionId}` wird
  zusammen mit **allen** im selben Zug betroffenen Dokumenten
  transaktional gespeichert: `dog_christmas_villages_v1` für das
  gemeinsam verdiente Licht sowie je **einem** persönlichen
  `dog_christmas_scratch_wallet_v1`-Dokument pro betroffenem Konto.
  Mehrere Lose desselben Spielers werden in **einem** Wallet-Schreiben
  zusammengefasst.
- Der Beleg erhält einen SHA-256-Fingerprint der festgestellten
  Buchungsdaten. Nach Firestore-Commit muss der identische
  Postgres-Auftrag bestätigt werden. Nach einem Absturz vor der
  Postgres-Bestätigung werden die Lichter und Lose nicht doppelt
  ausgezahlt.
- Bei reinen Kartenzügen ohne Licht/Geschenk/Los wird überhaupt
  **kein** Firebase-Buchungsbeleg benötigt. Diese sollen künftig
  ausschließlich über Render/Postgres laufen.

**Noch ausdrücklich gesperrt:** Endzüge, die Weihnachtsbelohnungen und
XP gemeinsam auslösen, sowie die Belohnungen aus Rubbellosen selbst.
Eine kombinierte Abschlussbrücke muss XP, Dorfkonto, persönlichen
Losbestand, Sieg und jeden Buchungsbeleg **in EINER** Firestore-Transaktion
abwickeln, wenn sie denselben letzten DOG-Zug betreffen.

**Noch nicht umgesetzt:** Die unveränderliche Postgres-Erzeugung
dieser per-Zug-Gewinnjobs und die Freigabe des neuen Spielstands erst
nach Auszahlung. Ohne diesen abgesicherten Erzeuger darf das
Weihnachtsevent **nicht** über die PG-Speicherung laufen. Die neuen
Offline-Tests verwenden nur Fake-Firebase und zuvor simulierte
PG-Gewinnjobs. Kein produktiver Firebase-Zugriff entsteht durch das
bloße Hinzufügen des Codes.
