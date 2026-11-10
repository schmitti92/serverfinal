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

**Status:** Im Entwicklungsbranch implementiert und mit 44 speziellen DOG- und Forge-Tests grün geprüft; **noch nicht auf dem Live-Server/auf Pages veröffentlicht**.

**Persönliche Kämpfe:** `POST /api/dog/gates/fight` berechnet Tor 1–9 und danach weitere Solo-Tore. Für die Teilnahme an Boss 10 zählen die acht normalen Tore 1–4 und 6–9. Mini-Boss 5 bleibt optional und kann nach einer Niederlage wiederholt werden. Alle persönlichen Siege und Teamstände sind serverseitig persistent und idempotent.

**Tor-10-Arena:** `dog-boss10.js` führt getrennt von der alten Tor-1-Testarena einen 30-Sekunden-Kampf. Endpunkte: `GET /api/dog/gates/boss10`, `POST .../ready`, `POST .../react`, `POST .../finish`. Alle drei müssen die normalen Vor-Tore geschafft haben und persönlich auf „Bereit“ drücken. Die Startzeit und Kampfantworten liegen auf dem Server. Pro Held gibt es höchstens einen Reaktionsbonus. Nach 30 Sekunden kann ein Gruppenmitglied den Kampf auf dem Server abschließen (der Webclient löst dies automatisch aus, solange geöffnet). Ein verlorener Kampf ergibt zehn Minuten gemeinsame Sperre. Ein Sieg wird atomar in `sharedBosses` gespeichert, schaltet gemeinsam Lv. 2 frei und setzt die aktuelle Kartenposition **mindestens auf Tor 11**, ohne bereits weiter fortgeschrittene Spieler zurückzusetzen.

**Aufstiegsschmiede:** `dog-ascension.js` ist für Mitglieder der authentifizierten Dreiergruppe reserviert und nutzt dieselben vorhandenen Hero- und Inventardokumente wie die alte Schmiede, aber mit neuem, boss-gesteuertem Maximallevel. `GET /api/dog/gates/ascension` liefert Lv.-Grenzen und Rohstoffkosten. `POST .../upgrade` führt einen einzigen authentifizierten, wiederholbaren Versuch aus, spendet Materialien und speichert Erfolg oder Misserfolg atomar. Nach Boss 10 lassen sich Waffe und Rüstung **jeweils von 1 auf 2** verbessern; Kosten: 3 Eisenerz bzw. 3 Lebensstaub, Erfolgswahrscheinlichkeit 100 %. Spätere Level bleiben bis zu nachfolgenden Gruppenbossen gesperrt.

**Mini-Boss 15:** Kann nach normalem Tor 14 begonnen werden; Boss-10-Sieg ist keine künstliche Zugangsbedingung. Die neue Ausrüstung (inklusive Rüstung und prozentualen Fähigkeiten) verbessert die Kampfchance deutlich. Die einmaligen Mini-Boss-Belohnungen sind als Erfolg markiert, ihre Gutschrift in andere Spieleökonomien ist noch nicht implementiert.

**Vor Live-Freigabe unbedingt prüfen:**
1. **Umgehungsschutz ergänzt:** Für Mitglieder der registrierten Dreier-Expedition prüft jetzt auch die bisherige `/api/dog/forge/...`-Schnittstelle die Boss-Freischaltung. Ihre neuen Ausrüstungslimits betragen 10 statt 20; auch die elf Fähigkeitslevel werden nach Bossfortschritt begrenzt. Bereits bestehende höhere Werte werden nicht abgeschnitten oder automatisch herabgestuft. Unbeteiligte Profile bleiben im bisherigen Modus. Dieser Migrationspfad muss trotzdem vor Live-Freigabe mit den realen Altbeständen geprüft werden.
2. Vorhandene Ausrüstung über Level 10 darf niemals stillschweigend herabgestuft oder überschrieben werden.
3. Bestehende Kisten (5–40 Rohstoffe) sind noch nicht auf die fünf neuen Kistentypen umgestellt.
4. Neues Frontend und neues Backend müssen gemeinsam ausgeliefert und mit echten drei Konten in einem isolierten Testsystem geprüft werden. Alte Boss-Testarena bleibt getrennt.
5. **Wiederaufnahme ergänzt:** Nach Ablauf der 30 Sekunden kann der authentifizierte `finish`-Aufruf entscheiden. Zusätzlich stellt der erste spätere authentifizierte `GET /api/dog/gates/boss10` einen steckengebliebenen Kampf durch eine Firestore-Transaktion einmalig wieder her. Bei einer Niederlage beginnt die 10-Minuten-Pause zum **ursprünglichen Kampfende**, auch wenn die Spieler erst später zurückkehren. Das ist keine asynchrone Hintergrundaufgabe.
6. Gemeinsame Bosse 20–100, Belohnungen sowie die endgültige DOG-Freischaltung bleiben ausstehend.

**Kartenpositionen:** Jeder Held hat zwei getrennte Werte: `currentGate` für das aktuell gewählte/zuletzt bekämpfte Tor und `highestGate` für sein höchstes jemals erreichtes Tor. Ältere Mini-Bosse dürfen erneut besucht werden, ohne den Bestwert zurückzusetzen. Andere Profile außerhalb des Dreierteams erhalten aus dem Kartenendpunkt nur eine anonyme Platzanzahl, keine Namen oder Torpositionen.

## Fünf Rohstoffkisten – gestaffelt über die 100 Tore

Die Art der Kiste wird beim **Verdienen** einer Kiste serverseitig aus dem persönlichen höchsten Tor gezogen. Der Inhalt wird zusammen mit Typ, Kapitel und Menge als neues **Version-4-Angebot** fixiert. Beim späteren Öffnen darf das Upgrade des Spielers die bereits verdiente Kiste **nicht** verändern.

| Typ | Design | Materialmenge | Erst möglich |
|---|---|---:|---|
| Holzkiste | Holz, Seil und Eisenbeschläge | 1–3 | Tor 1 |
| Eisenkiste | Geschmiedetes Eisen mit Schloss | 2–5 | Tor 21 |
| Silberkiste | Silberne Beschläge, blauer Schimmer | 4–8 | Tor 31 |
| Goldkiste | Goldene Schatztruhe mit Glühen | 6–12 | Tor 51 |
| Legendäre Truhe | Leuchtende Truhe mit magischen Runen | **10–20** | **Tor 81** |

Bei **Tor 1–20** gibt es ausschließlich Holzkisten. Die Menge ist darin gewichtet: **50 % für 1**, **35 % für 2**, **15 % für 3** Materialien. Andere Kisten verwenden innerhalb ihrer Größenklasse eine gleichmäßige Ziehung.

### Wahrscheinlichkeit pro verdiente Kiste

| Tore | Holz | Eisen | Silber | Gold | Legendär |
|---|---:|---:|---:|---:|---:|
| 1–10 | 100 % | 0 % | 0 % | 0 % | 0 % |
| 11–20 | 100 % | 0 % | 0 % | 0 % | 0 % |
| 21–30 | 80 % | 20 % | 0 % | 0 % | 0 % |
| 31–40 | 65 % | 30 % | 5 % | 0 % | 0 % |
| 41–50 | 45 % | 40 % | 15 % | 0 % | 0 % |
| 51–60 | 35 % | 45 % | 18 % | 2 % | 0 % |
| 61–70 | 25 % | 40 % | 28 % | 7 % | 0 % |
| 71–80 | 15 % | 33 % | 37 % | 15 % | 0 % |
| 81–90 | 10 % | 28 % | 38 % | 21 % | 3 % |
| 91–99 | 5 % | 20 % | 37 % | 31 % | 7 % |

Die legendäre Truhe ist eine **seltene große Menge**, nicht jede Kiste im letzten Abschnitt. Bei Tor 91–99 liegt die erwartete Menge über alle fünf Typen hinweg nur bei rund **6,84 Materialien je Kiste**. Damit bleibt die Materialbeschaffung auch mit hohen Schmiedestufen anspruchsvoll.

### Seltenheit der einzelnen Rohstoffe

Die Rohstoff-Seltenheiten sind von der **Kistenmenge getrennt**: Gewöhnlich / Ungewöhnlich / Selten / Episch / Legendär. Sie hängen weiterhin vom Abschnitt des eigenen Fortschritts ab:

| Tore | Gewöhnlich | Ungewöhnlich | Selten | Episch | Legendär |
|---|---:|---:|---:|---:|---:|
| 1–10 | 95 % | 5 % | 0 % | 0 % | 0 % |
| 11–20 | 82 % | 17 % | 1 % | 0 % | 0 % |
| 21–30 | 73 % | 24 % | 3 % | 0 % | 0 % |
| 31–40 | 62 % | 32 % | 6 % | 0 % | 0 % |
| 41–50 | 55 % | 32 % | 12 % | 1 % | 0 % |
| 51–60 | 47 % | 32 % | 18 % | 3 % | 0 % |
| 61–70 | 40 % | 30 % | 23 % | 6 % | 1 % |
| 71–80 | 32 % | 28 % | 25 % | 13 % | 2 % |
| 81–90 | 26 % | 26 % | 27 % | 17 % | 4 % |
| 91–99 | 22 % | 23 % | 28 % | 21 % | 6 % |

Neue Materialien können **vor** dem jeweiligen Gruppenboss selten gefunden werden. Das Schloss für das Waffen- oder Rüstungsupgrade löst sich trotzdem erst nach dem bestätigten gemeinsamen Boss-Sieg.

**Kompatibilität und noch offene Live-Integration:** Die alte Kisten-API speichert bisher drei Kistenklassen `small/medium/large` mit 5–40 Rohstoffen. Diese bereits verdienten Kisten dürfen bei der Migration nicht kleiner werden oder verloren gehen. Das fünfstufige Angebot ist derzeit ausschließlich in `dog-balance.js` und den Tests umgesetzt, noch nicht in der tatsächlichen Deal-Partie-Belohnung und dem Inventar-Öffnen. Frühere Version-3-Angebote des Balancingmodells bleiben lesbar; das Live-Legacy-Inventar ist davon unabhängig.

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
