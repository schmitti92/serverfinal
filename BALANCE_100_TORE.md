# Die 100 Tore – Balancing V1

**Status:** Isoliertes, getestetes Server-Regelmodul. Noch nicht an die Live-APIs angeschlossen.

## Regeln
- 80 normale persönliche Kämpfe, 10 Solo-Mini-Bosse bei 5, 15, …, 95 und 10 gemeinsame Bosse bei 10, 20, …, 100.
- Persönliche Tore dürfen **fünf Tore über einen noch nicht besiegten Gruppenboss hinaus** weitergespielt werden: Ohne Boss 10 bis Tor 15 (inklusive Mini-Boss 15), Tor 16 erfordert Boss 10; ohne Boss 20 bis Tor 25, Tor 26 erfordert Boss 20. Mini-Bosse sind eigene, anspruchsvolle Ausrüstungsprüfungen und müssen für die normalen Tore nicht zwingend besiegt werden.
- Gemeinsame Boss-Siege schalten zusätzliche Schmiedestufen frei: Waffen/Rüstung max. 10, Fähigkeiten max. 50.
- Waffen-/Rüstungsgrundwert: 100 × 2^(Level−1). Fähigkeiten wirken prozentual; die höchste mögliche Reaktion bleibt +10 %.
- Normale persönliche Tore (außer Mini-Boss und Gruppenboss) haben eine Server-Siegchance von 30–80 %, die aus relativem Waffen-/Rüstungslevel (bis +20 Prozentpunkte) sowie den jeweils zwei höchsten Angriffs- und Verteidigungsfähigkeiten (+30 Prozentpunkte) berechnet wird. Ein Held mit alter Ausrüstung kann die Tore 11–14 trotzdem mit etwa 30–45 % bestehen.

Mini-Bosse sind echte Solo-Kämpfe mit maximal vier Spielerangriffen, **ohne unfairen Gegner-Erstschlag**, aber mit Gegenangriffen, gelegentlichen schweren Treffern und Überlebensprüfung. Jeder Versuch liefert einen kleinen Animationsablauf und eine konkrete Empfehlung nach einer Niederlage. Sie bekommen LP passend zur vorherigen Ausrüstungsstufe. Mit passender Waffe **und** Rüstung sind sie deutlich besser schaffbar, aber nicht automatisch gewonnen (Beispielstufe 15: ca. 58 % unter dem definierten mittleren Build). Ein überdurchschnittlich entwickelter Held erhöht ihre LP und Gegenangriffe nur leicht um höchstens 10 %; ein schwacher Held erhält keinen künstlich leichteren Boss. Große Bosse sind auf drei gut vorbereitete Spieler mit je sechs Angriffen innerhalb von 30 Sekunden ausbalanciert; mit einem oder zwei Teilnehmern darf man antreten, ist aber stark benachteiligt.

## Gewichtung und Boss-System: Absprachen vs. Balancing-Entwurf

**Verbindliche Spielprinzipien aus der Planung:**

1. Die Solo-Kämpfe folgen der Karte. An Mini-Bossen 5, 15, …, 95 sind Waffe **und** Rüstung entscheidend. Ein Held kann Tor 15 schon vor dem gemeinsamen Sieg über Boss 10 erreichen und herausfordern, hat dann aber eine sehr geringe Chance auf Erfolg. Die harte Schranke beginnt erst bei Tor 16. Das gleiche Prinzip gilt für Tor 25/26 und weitere Zehnerabschnitte.
2. Die 10 gemeinsamen Gruppenbosse (10,20,…,100) lassen sich mit **1, 2 oder 3 bereitgemeldeten Helden** starten: Einer alleine kann niemals gewinnen, zwei vollständig vorbereitete Spieler haben nur bei einem seltenen Sondertreffer eine kleine Chance, **drei gut ausgerüstete Spieler sind der Normalfall**. Ist das Dreierteam vollständig bereit, beginnt der Kampf automatisch. Die Kampfzeit beträgt **30 Sekunden**; nach einer Niederlage folgt eine **10-Minuten-Gruppensperre**. Waffe, Rüstung und Fähigkeiten bestimmen den Teamschaden; eine Reaktion erhöht den individuellen Schaden höchstens um 10 %, nicht die Basisausrüstung.
3. Gemeinsame Bosssiege schalten zusätzliche persönliche Schmiedestufen frei. Die Helden besitzen eigene Waffen/Rüstungen, eigene Materialien und Fähigkeiten; nur der Bossfortschritt wird gemeinsam gespeichert.
4. **Endziel:** Das DOG-Spiel wird erst nach dem bestätigten Sieg über den **letzten gemeinsamen Boss bei Tor 100** für alle drei freigeschaltet; die Route darf keinen unautorisierten Direktzugang erlauben.

**Nur vorläufig kalibriert, nicht als endgültige Nutzerentscheidung behandeln:**
- Normale Kämpfe: 30–80 % Server-Siegchance, derzeit 30 Punkte Ausgangswert + bis zu 20 Prozentpunkte für Ausrüstungsbereitschaft + bis zu 30 für Fähigkeiten-Mastery. Diese **Gewichtung macht Fähigkeiten rechnerisch stärker als den direkten Ausrüstungsanteil** und muss vor der Live-Freigabe auf das Prinzip „Ausrüstung als Hauptfaktor“ geprüft werden.
- Solo-Mini-Bosse: Vier eigene Angriffe mit Gegenangriffen. Das skalierte Bossprofil wird höchstens um 10 % wegen überdurchschnittlicher Ausrüstung/Fähigkeiten verstärkt. Die repräsentativen 4.500er-Simulationen weiter unten illustrieren, dass nur Waffe plus Rüstung verlässlich helfen.
- Boss 10 (aktualisiert): In der 30-Sekunden-Runde werden sechs Angriffe je teilnehmendem Helden anhand von Waffenwert, offensiven Fertigkeiten und überlebenswirksamen Rüstungs-/Defensivwerten zum Gesamtschaden zusammengefasst. Die **Boss-LP** sind jetzt die echte Siegschwelle. Ein Einzelkämpfer kann sie nie überwinden. Zwei Helden mit *maximal möglicher* Vorbereitung (einschließlich beider Reaktionen) dürfen nur bei einem **2-%-Sondertreffer** gewinnen. Drei gut ausgerüstete Helden können die LP im regulären Kampf übertreffen. Die Gegner schlagen noch nicht als individuelle Live-Timeline zurück: Das Schaden-/Überlebensmodell ist ein serverseitiges 30-Sekunden-Aggregat; Bossangriffsanimationen bleiben ein Ausbaupunkt.
- Folgebosse 20–100 sind jetzt in der wiederverwendbaren Serverdatei `dog-group-boss.js` implementiert. Die neun Boss-LP und die Ausrüstungswirkung werden pro Tor skaliert. Endgültige Balancingwerte, Trefferanimationen und sichtbare Gegenangriffe erfordern weitere Tests.

## Gruppenbosse 20–100: wiederverwendbare Kampf-Engine

**Status: im Entwicklungsbranch implementiert, noch nicht live.** Die Karte öffnet die neun Bossarenen von Tor 20 bis 100 über `dog-group-boss.html?gate=<Tor>`.

- **Gegner:** Tor 20 Schattenfürst; 30 Kristallwurm; 40 Dornenkönig; 50 Hüter der Tiefe; 60 Flammendrache; 70 Seelenrichter; 80 Eisenkoloss; 90 Festungswächter; 100 Der letzte Wächter.
- **Zugang:** Der vorige gemeinsame Boss muss besiegt sein. Jeder teilnehmende Spieler benötigt die acht normalen Tore des aktuellen Abschnitts, Mini-Bosse bleiben optional. Beispiel: Boss 20 setzt Boss 10 sowie normale Tore 11–14 und 16–19 voraus.
- **Teilnehmer:** Ein Spieler kann starten, gewinnt aber niemals. Zwei Spieler gewinnen ausschließlich, wenn beide die für diesen Boss maximal erreichbare Waffe, Rüstung und vier relevante Fähigkeiten besitzen, beide reagieren und der **2-%-Sondertreffer** eintritt. Drei gut aufgerüstete Spieler sollen regulär gewinnen können. Sobald alle drei bereit sind, startet der Kampf automatisch; sonst können ein oder zwei bereite Spieler manuell starten.
- **Kampf:** 30 Sekunden, sechs Angriffe je Teilnehmer als serverseitiges Schadensaggregat. Reaktion +10 % Schaden pro aktivem Helden. Waffen, Rüstungen und Fähigkeitsstufen wirken auf den wirklichen Gesamtschaden gegen die jeweils höheren Boss-LP.
- **Sicherheit:** Authentifizierte Aktionen und Firestore-Transaktionen. Einmalige Quittungen für Start, Bereit, Reaktion und Ende verhindern doppelte Siege. Verlorene Kämpfe verursachen 10 Minuten gemeinsame Pause ab ursprünglichem Kampfende. Beim nächsten Öffnen können abgelaufene Kämpfe zuverlässig abgeschlossen werden.
- **Fortschritt:** Alle Gruppenmitglieder erhalten den gemeinsamen Sieg und die freigeschaltete Schmiedestufe; die persönlichen Torpositionen der tatsächlich beteiligten Helden können vorrücken, werden aber niemals zurückgesetzt. Die neun Kampfstände stehen in `groupBosses`, Boss 10 behält den älteren Zustand `boss10`.
- **Tor 100:** Der bestätigte letzte Sieg wird in `sharedBosses` gespeichert und aktiviert das `dogUnlocked`-Kennzeichen der Eventkarte. **Eine serverseitige Sperre für das eigenständige DOG-Spiel ist noch nicht eingebaut.** Der Spielzugang darf deshalb vor Freigabe nicht als abgesichert gelten.

**Noch offen:** echtes Drei-Konten-End-to-End-Testing, Belastung unter Verbindungsabbrüchen, Kampfanimationen mit Boss-Gegenangriffen, finaler DOG-Spielzugang und Zusammenführung mit den aktuellen Hauptbranches.

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

**Tor-10-Arena:** `dog-boss10.js` führt getrennt von der alten Tor-1-Testarena einen 30-Sekunden-Kampf. Endpunkte: `GET /api/dog/gates/boss10`, `POST .../ready`, **`POST .../start`**, `POST .../react`, `POST .../finish`. Nur die tatsächlich teilnehmenden Helden müssen die normalen Vor-Tore geschafft und auf „Bereit“ geklickt haben. **Ein oder zwei Bereite können manuell starten**, alle drei Bereite starten automatisch. Die Startzeit und Kampfantworten liegen auf dem Server. Pro Held gibt es höchstens einen Reaktionsbonus. Nach 30 Sekunden kann ein Gruppenmitglied den Kampf auf dem Server abschließen (der Webclient löst dies automatisch aus, solange geöffnet). Ein verlorener Kampf ergibt zehn Minuten gemeinsame Sperre. Ein Sieg wird atomar in `sharedBosses` gespeichert, schaltet gemeinsam Lv. 2 frei und setzt die aktuelle Kartenposition **mindestens auf Tor 11**, ohne bereits weiter fortgeschrittene Spieler zurückzusetzen.

**Aufstiegsschmiede:** `dog-ascension.js` ist für Mitglieder der authentifizierten Dreiergruppe reserviert und nutzt dieselben vorhandenen Hero- und Inventardokumente wie die alte Schmiede, aber mit neuem, boss-gesteuertem Maximallevel. `GET /api/dog/gates/ascension` liefert Lv.-Grenzen und Rohstoffkosten. `POST .../upgrade` führt einen einzigen authentifizierten, wiederholbaren Versuch aus, spendet Materialien und speichert Erfolg oder Misserfolg atomar. Nach Boss 10 lassen sich Waffe und Rüstung **jeweils von 1 auf 2** verbessern; Kosten: 3 Eisenerz bzw. 3 Lebensstaub, Erfolgswahrscheinlichkeit 100 %. Spätere Level bleiben bis zu nachfolgenden Gruppenbossen gesperrt.

**Mini-Boss 15:** Kann nach normalem Tor 14 begonnen werden; Boss-10-Sieg ist keine künstliche Zugangsbedingung. Die neue Ausrüstung (inklusive Rüstung und prozentualen Fähigkeiten) verbessert die Kampfchance deutlich. Der **erste Sieg** über einen Mini-Boss vergibt inzwischen **eine zufällige echte Belohnung** in derselben Firestore-Transaktion wie den Sieg. Scheitert die Gutschrift, wird der Sieg nicht gespeichert.

**Vor Live-Freigabe unbedingt prüfen:**
1. **Umgehungsschutz ergänzt:** Für Mitglieder der registrierten Dreier-Expedition prüft jetzt auch die bisherige `/api/dog/forge/...`-Schnittstelle die Boss-Freischaltung. Ihre neuen Ausrüstungslimits betragen 10 statt 20; auch die elf Fähigkeitslevel werden nach Bossfortschritt begrenzt. Bereits bestehende höhere Werte werden nicht abgeschnitten oder automatisch herabgestuft. Unbeteiligte Profile bleiben im bisherigen Modus. Dieser Migrationspfad muss trotzdem vor Live-Freigabe mit den realen Altbeständen geprüft werden.
2. Vorhandene Ausrüstung über Level 10 darf niemals stillschweigend herabgestuft oder überschrieben werden.
3. **Fünf neue Kistenarten integriert:** In `deal-or-no-deal-api.js` werden neue Expeditionskisten im selben bestätigten Auszahlungs-Receipt gespeichert. Das Inventar unterscheidet fünf neue Kisten und bewahrt ältere `small/medium/large/legacy`-Kisten unverändert auf. **Vor Live-Freigabe** muss diese neue gemischte Inventarstruktur mit echten Altbeständen geprüft werden.
4. Neues Frontend und neues Backend müssen gemeinsam ausgeliefert und mit echten drei Konten in einem isolierten Testsystem geprüft werden. Alte Boss-Testarena bleibt getrennt.
5. **Wiederaufnahme ergänzt:** Nach Ablauf der 30 Sekunden kann der authentifizierte `finish`-Aufruf entscheiden. Zusätzlich stellt der erste spätere authentifizierte `GET /api/dog/gates/boss10` einen steckengebliebenen Kampf durch eine Firestore-Transaktion einmalig wieder her. Bei einer Niederlage beginnt die 10-Minuten-Pause zum **ursprünglichen Kampfende**, auch wenn die Spieler erst später zurückkehren. Das ist keine asynchrone Hintergrundaufgabe.
6. Bosse 20–100 sind jetzt implementiert. Zusätzliche Gruppenboss-Prämien, Kampfanimationen und die sichere Freischaltung der eigenständigen DOG-Spielroute bleiben ausstehend.

**Kartenpositionen:** Jeder Held hat zwei getrennte Werte: `currentGate` für das aktuell gewählte/zuletzt bekämpfte Tor und `highestGate` für sein höchstes jemals erreichtes Tor. Ältere Mini-Bosse dürfen erneut besucht werden, ohne den Bestwert zurückzusetzen. Andere Profile außerhalb des Dreierteams erhalten aus dem Kartenendpunkt nur eine anonyme Platzanzahl, keine Namen oder Torpositionen.

## Fünf Rohstoffkisten – gestaffelt über die 100 Tore

Die Art der Kiste wird beim **bestätigten Abschluss einer Deal-or-No-Deal-Partie** aus dem persönlichen höchsten Tor gezogen. **Typ, Kapitel und Rohstoffanzahl** werden als neues **Version-4-Angebot** unveränderlich gespeichert; die konkrete Verteilung auf die 15 Materialien wird erst beim Öffnen serverseitig gezogen. Eine spätere Fortschrittsverbesserung darf die früher verdiente Kistenart oder -menge **nicht** verändern. Gleiche Angebote werden für begrenzten Firestore-Speicherplatz zusammengefasst.

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

**Integrierter Entwicklungsstand und Kompatibilität:** `dog-materials.js` verwaltet die fünf neuen Typen in `expeditionChests`, getrennt von `chests.small/medium/large/legacy`. Beim Auszahlen einer bestätigten Deal-Partie werden Mitglieder des registrierten Dreierteams nach ihrem `highestGate` mit einer neuen, beim Erhalt fixierten Kiste belohnt; andere Konten behalten vorerst das alte Vergabemodell. Der bereits vorhandene Deal-Auszahlungsbeleg verhindert doppelte Auszahlungen und doppelte Kisten. `POST /api/dog/materials/open` öffnet neue oder alte Kisten durch eine separate wiederholungssichere Firestore-Transaktion. Das Frontend bietet alle fünf neuen und die alten Kisten getrennt an. Vor dem Merge müssen Altbestände und der parallele Abschluss echter Deal-Partien getestet werden. Kein Live-Rollout durchgeführt.

## Einmalige Mini-Boss-Siegprämien (Tor 5, 15, …, 95)

Die erste erfolgreiche persönliche Mini-Boss-Prüfung wählt **genau eine** der folgenden Belohnungen. Ein weiterer Sieg am selben Tor ist gesperrt; ein Wiederholen derselben Anfrage-ID liefert denselben Sieg und dieselbe zuvor festgelegte Prämie zurück.

| Preis | Chance | Serverseitig gespeicherte Gutschrift |
|---|---:|---|
| 📦 Zusätzliche Rohstoffkiste | 35 % | Eine der fünf Expeditionstruhen passend zum höchsten erreichten Tor; die Materialanzahl steht bei der Vergabe fest |
| 💰 Geldprämie | 30 % | Deal-or-No-Deal-Guthaben; Tor 5 = 50.000 €, Tor 95 = 5.000.000 €, dazwischen quadratisch gestaffelt |
| 🎴 Kartenpaket-Gutschein | 20 % | Ein kostenloses Weihnachtskartenpaket (`freeChristmasPacks`); anfangs klein, später auch groß oder Premium möglich |
| 🔨 Hammer | 10 % | Ein Hammer im Eisblock-Inventar; anfangs Einzelhammer, ab Tor 35 auch Doppelhammer, ab Tor 75 auch Goldhammer |
| 🃏 Koffer-Joker | 5 % | Ein Joker im bestehenden Deal-Joker-Inventar |

**Sicherung:** Der Server berechnet den Mini-Boss-Kampf, entscheidet bei erstem Sieg die Prämie und liest nur das tatsächlich betroffene Spieler-Inventar. Kampffortschritt, Belohnung, persönliche Prämienhistorie und unveränderlicher Anfrage-Beleg werden **zusammen in einer Firestore-Transaktion** geschrieben. Abbrüche verursachen dadurch keine halben Gutschriften. Öffnet der Spieler später die Kartenansicht, kann er seine Prämie am jeweiligen Tor erneut nachlesen; andere Teamspieler sehen nur den Torfortschritt, nicht die fremde Prämie. Es werden keine zusätzlichen Firebase-Reads für die Belohnungshistorie benötigt.

Diese Belohnungen sind im **Entwicklungsbranch** eingebaut, nicht auf Render/GitHub Pages live. Der Preis-Katalog gehört zum Stand dieser Version und kann vor dem Live-Rollout erneut balanciert werden.

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
