# Die 100 Tore – Balancing V1

**Status:** Isoliertes, getestetes Server-Regelmodul. Noch nicht an die Live-APIs angeschlossen.

## Regeln
- 80 normale persönliche Kämpfe, 10 Solo-Mini-Bosse bei 5, 15, …, 95 und 10 gemeinsame Bosse bei 10, 20, …, 100.
- Persönliche Tore bleiben erreichbar, auch wenn die Gruppe einen Boss noch nicht besiegt hat.
- Gemeinsame Boss-Siege schalten zusätzliche Schmiedestufen frei: Waffen/Rüstung max. 10, Fähigkeiten max. 50.
- Waffen-/Rüstungsgrundwert: 100 × 2^(Level−1). Fähigkeiten wirken prozentual; die höchste mögliche Reaktion bleibt +10 %.
- Mini-Bosse bekommen LP passend zur vorherigen Ausrüstungsstufe; große Bosse werden anhand von drei Spielern über je sechs Angriffe in 30 Sekunden skaliert.

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

## Ausrüstungsschmiede
Materialkosten Waffe: Level 2 = 3 Eisenerz; 3 = 2 Eisenerz + 1 Schmiedekohle; 4 = 2 Schmiedekohle; 5 = 2 Schmiedekohle + 1 Stahlkern; 6 = 3 Stahlkern; 7 = 2 Stahlkern + 1 Mithril; 8 = 2 Mithril; 9 = 3 Mithril; 10 = 2 Mithril + 1 Drachenstahl.

Die Rüstung nutzt die parallelen Verteidigungsmaterialien. Vorgesehene Erfolgswahrscheinlichkeiten für Level 2–10: 100, 95, 90, 85, 75, 65, 55, 45, 35 %. Bei Fehlschlag gehen Materialien verloren, nicht das bestehende Level.

## Vor Live-Schaltung
1. Persönliche Tore und gemeinsame Boss-Siege serverseitig speichern.
2. Bestehende Spielerbestände über Level 10 sichern; keine automatische Herabstufung.
3. Kisten-Snapshots nur serverseitig ausstellen/öffnen; vorhandene Kisten unverändert erhalten.
4. Eigenes Solo-Kampfsystem und 30-Sekunden-Teamkampf integrieren, inklusive Überlebenswahrscheinlichkeiten.
5. Vollständige Gewinnquoten und Rohstoff-Farmingdauer in Simulationen prüfen.
6. Bestehende Kisten- und Boss-APIs sind durch diesen isolierten Branch **nicht** verändert.

Tests: `node --test tests/dog-balance.test.js`.
