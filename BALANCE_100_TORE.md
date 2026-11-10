# Die 100 Tore – Balancing V1

**Status:** Isoliertes, getestetes Server-Regelmodul. Noch nicht an die Live-APIs angeschlossen.

## Regeln
- 80 normale persönliche Kämpfe, 10 Solo-Mini-Bosse bei 5, 15, …, 95 und 10 gemeinsame Bosse bei 10, 20, …, 100.
- Persönliche Tore bleiben erreichbar, auch wenn die Gruppe einen Boss noch nicht besiegt hat.
- Gemeinsame Boss-Siege schalten zusätzliche Schmiedestufen frei: Waffen/Rüstung max. 10, Fähigkeiten max. 50.
- Waffen-/Rüstungsgrundwert: 100 × 2^(Level−1). Fähigkeiten wirken prozentual; die höchste mögliche Reaktion bleibt +10 %.
- Normale persönliche Tore (außer Mini-Boss und Gruppenboss) haben eine Server-Siegchance von 30–80 %, die aus relativem Waffen-/Rüstungslevel (bis +20 Prozentpunkte) sowie den jeweils zwei höchsten Angriffs- und Verteidigungsfähigkeiten (+30 Prozentpunkte) berechnet wird. Ein Held mit alter Ausrüstung kann die Tore 11–14 trotzdem mit etwa 30–45 % bestehen.

Mini-Bosse sind echte Solo-Kämpfe mit maximal vier Spielerangriffen, **ohne unfairen Gegner-Erstschlag**, aber mit Gegenangriffen, gelegentlichen schweren Treffern und Überlebensprüfung. Jeder Versuch liefert einen kleinen Animationsablauf und eine konkrete Empfehlung nach einer Niederlage. Sie bekommen LP passend zur vorherigen Ausrüstungsstufe. Mit passender Waffe **und** Rüstung sind sie deutlich besser schaffbar, aber nicht automatisch gewonnen (Beispielstufe 15: ca. 58 % unter dem definierten mittleren Build). Ein überdurchschnittlich entwickelter Held erhöht ihre LP und Gegenangriffe nur leicht um höchstens 10 %; ein schwacher Held erhält keinen künstlich leichteren Boss. Große Bosse werden separat anhand von drei Spielern über je sechs Angriffe in 30 Sekunden skaliert.

## Drei Spieler auf derselben Karte (neuer API-Entwurf)

Ein gemeinsamer Dreier-Kader wird aus der bestehenden `dog-boss.js`-Teamstruktur gelesen. Alle drei erhalten **ihre eigenen Torpositionen** im neuen, zusammengefassten Firestore-Dokument `dog_gate_progress_v1/first-three-heroes`. Die Karte benötigt dafür nur zwei Dokument-Lesevorgänge: Teamroster und Fortschritt. Sie wird nur bei sichtbarer Seite etwa einmal pro Minute oder nach einer Aktion aktualisiert, nicht per Dauer-Polling im Sekundentakt.

- `GET /api/dog/gates/map`: authentifizierte Übersicht mit den drei gespeicherten Torpositionen; meldet keinen erfundenen Online-Status.
- `POST /api/dog/gates/join`: Konto tritt idempotent dem serververwalteten Dreierteam bei (maximal drei Personen), ohne künstliche Torfortschritte.
- `POST /api/dog/gates/fight`: nur persönliche Normal- und Mini-Boss-Tore zwischen 1–99; Pflicht zur erfolgreichen Absolvierung des vorherigen **normalen** Tors. Frühere Mini-Bosse und Gruppenbosse werden dadurch **nicht** zur harten Wegsperre.
- Ein Konto kann Tor 1 nicht für Tor 20 überspringen und aus einem abgelehnten Kampf keine Belohnung erhalten. Der Server verwendet die gespeicherte Waffe, Rüstung und die Fähigkeiten, nicht Client-Eingaben.
- Jede Kampfaktion erhält eine eindeutig wiederholbare Anfrage-ID; der serverseitige Zufallswurf und der neue persönliche Fortschritt werden in **einer Firestore-Transaktion** gespeichert.
- Ein erstmaliger Mini-Boss-Sieg meldet vorerst nur `miniRewardPending`; die eigentliche zufällige Belohnung ist **noch nicht** in die Karten-, Hammer-, Joker- und Geldkonten integriert. Keine Phantom-Gutschrift.
- Der vorhandene gemeinsame Aschewächter ist technisch noch ein **Tor-1-Testboss**. Die Karte kann über Tor 10 zur bestehenden Testarena führen, aber die echte Tor-10-Freischaltung und weitere Gruppenboss-Arenen müssen später sicher angebunden werden.

**Wichtig:** Diese API ist Bestandteil von Draft-PR #19 und nicht automatisch live, solange Server und Frontend auf ihrem Entwicklungsbranch stehen. Karten-PR #90 benötigt diese Server-API.

## Erster geschlossener Kreislauf: Tore 1–9 → Boss 10 → Schmiede 2 → Mini-Boss 15

**Status:** Im Entwicklungsbranch implementiert und mit 29 speziellen DOG-Tests grün geprüft; **noch nicht auf dem Live-Server/auf Pages veröffentlicht**.

**Persönliche Kämpfe:** `POST /api/dog/gates/fight` berechnet Tor 1–9 und danach weitere Solo-Tore. Für die Teilnahme an Boss 10 zählen die acht normalen Tore 1–4 und 6–9. Mini-Boss 5 bleibt optional und kann nach einer Niederlage wiederholt werden. Alle persönlichen Siege und Teamstände sind serverseitig persistent und idempotent.

**Tor-10-Arena:** `dog-boss10.js` führt getrennt von der alten Tor-1-Testarena einen 30-Sekunden-Kampf. Endpunkte: `GET /api/dog/gates/boss10`, `POST .../ready`, `POST .../react`, `POST .../finish`. Alle drei müssen die normalen Vor-Tore geschafft haben und persönlich auf „Bereit“ drücken. Die Startzeit und Kampfantworten liegen auf dem Server. Pro Held gibt es höchstens einen Reaktionsbonus. Nach 30 Sekunden kann ein Gruppenmitglied den Kampf auf dem Server abschließen (der Webclient löst dies automatisch aus, solange geöffnet). Ein verlorener Kampf ergibt zehn Minuten gemeinsame Sperre. Ein Sieg wird atomar in `sharedBosses` gespeichert, schaltet gemeinsam Lv. 2 frei und setzt die aktuelle Kartenposition **mindestens auf Tor 11**, ohne bereits weiter fortgeschrittene Spieler zurückzusetzen.

**Aufstiegsschmiede:** `dog-ascension.js` nutzt dieselben vorhandenen Hero- und Inventardokumente wie die alte Schmiede, aber mit neuem, boss-gesteuertem Maximallevel. `GET /api/dog/gates/ascension` liefert Lv.-Grenzen und Rohstoffkosten. `POST .../upgrade` führt einen einzigen authentifizierten, wiederholbaren Versuch aus, spendet Materialien und speichert Erfolg oder Misserfolg atomar. Nach Boss 10 lassen sich Waffe und Rüstung **jeweils von 1 auf 2** verbessern; Kosten: 3 Eisenerz bzw. 3 Lebensstaub, Erfolgswahrscheinlichkeit 100 %. Spätere Level bleiben bis zu nachfolgenden Gruppenbossen gesperrt.

**Mini-Boss 15:** Kann nach normalem Tor 14 begonnen werden; Boss-10-Sieg ist keine künstliche Zugangsbedingung. Die neue Ausrüstung (inklusive Rüstung und prozentualen Fähigkeiten) verbessert die Kampfchance deutlich. Die einmaligen Mini-Boss-Belohnungen sind als Erfolg markiert, ihre Gutschrift in andere Spieleökonomien ist noch nicht implementiert.

**Vor Live-Freigabe unbedingt prüfen:**
1. Getrennte alte Schmiede ist derzeit weiterhin auf Level 20 ausgelegt und könnte neue Aufstiegsgrenzen umgehen. Entweder migrieren und dort dieselben Regeln erzwingen oder die alte Route für aktive Expeditionsteilnehmer vorübergehend sperren. **Nicht ohne diese Sperre veröffentlichen.**
2. Vorhandene Ausrüstung über Level 10 darf niemals stillschweigend herabgestuft oder überschrieben werden.
3. Bestehende Kisten (5–40 Rohstoffe) sind noch nicht auf die neuen Kapitelmengen umgestellt.
4. Neues Frontend und neues Backend müssen gemeinsam ausgeliefert und mit echten drei Konten in einem isolierten Testsystem geprüft werden. Alte Boss-Testarena bleibt getrennt.
5. Die Bestätigung nach Ablauf der 30 Sekunden erfolgt durch einen nachfolgenden authentifizierten `finish`-Aufruf; wenn alle drei offline sind, verbleibt das Ergebnis bis zum nächsten Aufruf ausstehend. Keine angebliche Hintergrundverarbeitung.
6. Gemeinsame Bosse 20–100, Belohnungen sowie die endgültige DOG-Freischaltung bleiben ausstehend.

## Rohstoffe je persönlichem Kapitel

| Tore | Kisteninhalt | Gewöhnlich | Ungewöhnlich | Selten | Episch | Legendär |
|---|---:|---:|---:|---:|---:|---:|
| 1–10 | 1–2 | 95% | 5% | 0% | 0% | 0% |
| 11–20 | 1–3 | 82% | 17% | 1% | 0% | 0% |
| 21–30 | 2–3 | 73% | 24% | 3% | 0% | 0% |
| 31–40 | 2–4 | 62% | 32% | 6% | 0% | 0% |
| 41–50 | 3–5 | 55% | 32% | 12% | 1% | 0% |
| 51–60 | 3–6 | 47% | 32% | 18% | 3% | 0% |
| 61–70 | 4–7 | 40% | 30% | 23% | 6% | 1% |
| 71–80 | 5–8 | 32% | 28% | 25% | 13% | 2% |
| 81–90 | 6–9 | 26% | 26% | 27% | 17% | 4% |
| 91–99 | 7–10 | 22% | 23% | 28% | 21% | 6% |

Neue Materialien erscheinen schon **vor** dem gemeinsamen Boss, dessen Sieg das zugehörige Upgrade freischaltet. Kistengröße und Gewichtung müssen beim Erhalt auf dem Server eingefroren werden, damit spätere Levelaufstiege alte Kisten nicht nachträglich vergrößern.

## Mini-Boss-Feinschliff (simulierte Siegquoten)

| Tor | Vollständig verbessertes Beispielprofil | Nur Waffe verbessert |
|---|---:|---:|
| 15 | 57,7 % | 12,7 % |
| 25 | 57,7 % | 14,0 % |
| 35 | 60,3 % | 15,0 % |
| 45 | 60,2 % | 14,3 % |
| 55 | 62,0 % | 2,6 % |
| 65 | 64,6 % | 2,5 % |
| 75 | 63,3 % | 3,0 % |
| 85 | 65,9 % | 3,8 % |
| 95 | 67,2 % | 4,3 % |

Die Quoten stammen aus jeweils 4.500 reproduzierbaren Kämpfen pro Vergleichsprofil; sie sind **kein hartes Gewinnversprechen** für reale Spieler. Der Angriff des Mini-Bosses wird nur leicht an sehr starke Spieler angepasst (maximal +10 %), während Waffe und Rüstung Fortschritt bringen. Schwerere Gegenangriffe verhindern automatische Siege nach einem bloßen Waffen-Upgrade.

**Kompatibilität:** Neue Kisten liefern im Entwurfsmodell für jede der 15 Materialarten einen ganzzahligen Zähler, auch wenn er null ist. Das entspricht dem Schema der bisherigen Inventarvalidierung. Alt-Kisten verbleiben unverändert.

## Ausrüstungsschmiede
Materialkosten Waffe: Level 2 = 3 Eisenerz; 3 = 2 Eisenerz + 1 Schmiedekohle; 4 = 2 Schmiedekohle; 5 = 2 Schmiedekohle + 1 Stahlkern; 6 = 3 Stahlkern; 7 = 2 Stahlkern + 1 Mithril; 8 = 2 Mithril; 9 = 3 Mithril; 10 = 2 Mithril + 1 Drachenstahl.

Die Rüstung nutzt die parallelen Verteidigungsmaterialien. Vorgesehene Erfolgswahrscheinlichkeiten für Level 2–10: 100, 95, 90, 85, 75, 65, 55, 45, 35 %. Bei Fehlschlag gehen Materialien verloren, nicht das bestehende Level.

## Vor Live-Schaltung
1. Persönliche Tore und gemeinsame Boss-Siege serverseitig speichern.
2. Bestehende Spielerbestände über Level 10 sichern; keine automatische Herabstufung.
3. Kisten-Snapshots nur serverseitig ausstellen/öffnen; vorhandene Kisten unverändert erhalten.
4. Eigenes Solo-Kampfsystem und 30-Sekunden-Teamkampf integrieren, inklusive Überlebenswahrscheinlichkeiten.
5. Die **15 isolierten Balancingtests** sind im DOG-Balance-Workflow erfolgreich. Vor Freigabe **vollständige** End-to-End-Tests der Firestore-Transaktionen, normalen Siegreceipts und Ressourcenbelohnungen ergänzen.
6. Für normale Tore darf das Ergebnis von `dogResolveNormalGate()` pro serverbestätigter Aktion nur **einmal** gezogen und unter einer wiederholbaren Request-ID gespeichert werden. Sonst könnten wiederholte Requests zusätzliche Würfe erzeugen.
7. Vollständige Gewinnquoten und Rohstoff-Farmingdauer unter echtem Spieler-Upgradeverhalten und der 30-Sekunden-Kampfdauer prüfen.
8. Bestehende Kisten- und Boss-APIs sind durch diesen isolierten Branch **nicht** verändert. Die systemweiten Repository-Tests haben bereits auf `main` bekannte Fehlschläge; der eigene DOG-Balance-Workflow ist erfolgreich.

Tests: `node --test tests/dog-balance.test.js`.
