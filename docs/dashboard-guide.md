# Dashboard verstehen

Diese Anleitung beschreibt das aktuelle Aktivitaets-Dashboard von NZBStreamer:
was angezeigt wird, woher die Werte kommen, wann sie sich veraendern und welche
Schlussfolgerungen man daraus ziehen darf.

> Wichtig: NZBDavEx ist kein klassischer Downloader, der vor jeder Wiedergabe
> einen ganzen Film auf der lokalen Festplatte ablegt. Es kann Dateien virtuell
> bereitstellen und benoetigte Usenet-Daten beim Lesen nachladen. Deshalb sind
> Warteschlange, History, aktive Lesevorgaenge und Datenverbrauch unterschiedliche
> Dinge.

## 1. Aufbau und Bedienung

Nach der Anmeldung startet die Admin-Oberflaeche im Dashboard. Die Reihenfolge ist:

1. Ueberschrift, Refresh, Aktualisierungsstatus und eventuelle Fehlermeldungen.
2. Sechs Kennzahlen: Backend, Queued downloads, History items, Active reads,
   Data served / minute und Catalogue files.
3. Provider usage.
4. NZBStreamer caches.
5. Download queue.
6. Recent history mit Seitenwechsel.

Das Dashboard startet keine Downloads, setzt keine Providerzaehler zurueck und
aendert keine Einstellungen. Refresh fragt lediglich die aktuellen Daten erneut
ab. Eine ausdruecklich bestaetigte Ausnahme ist **Clear history**: Diese Aktion
loescht History-Eintraege, behaelt aber virtuelle Dateien.

### Aktualisierung

- Beim Oeffnen der Dashboard-Ansicht wird geladen.
- Solange das Dashboard ausgewaehlt und der Browser-Tab sichtbar ist, wird etwa
  alle **15 Sekunden** erneut abgefragt.
- In einem unsichtbaren Browser-Tab werden die Intervallabfragen uebersprungen.
  Nach der Rueckkehr kann es bis zum naechsten Intervall dauern.
- Beim Wechsel in einen anderen Admin-Bereich stoppt das Dashboard-Polling.
- Refresh loest eine manuelle Abfrage aus. Waehrenddessen ist der Button
  deaktiviert; sein Symbol dreht sich, sofern reduzierte Bewegung nicht
  aktiviert ist.
- Es gibt keine parallelen Dashboard-Ladevorgaenge im selben UI.
- Die ausgewaehlte History-Seite bleibt beim Aktualisieren erhalten.

Das ist eine regelmaessige Momentaufnahme, kein lueckenloser Live-Monitor.
Ein Auftrag, der zwischen zwei Abfragen fertig wird, kann in der Queue
unsichtbar bleiben und direkt in der History erscheinen.

Die Uhrzeit bei `Updated` stammt aus der Dashboard-Antwort und wird im Browser
lokal formatiert. Die Quellen werden parallel abgefragt, nicht in einer gemeinsamen
Datenbanktransaktion. Kleine zeitliche Unterschiede zwischen Kennzahlen sind
deshalb moeglich.

## 2. Woher kommen die Daten?

```text
Admin-Browser mit angemeldeter Sitzung
    |
    | GET /admin/api/dashboard?historyPage=1
    v
NZBStreamer (Node.js)
    |-- eigene lokale Cache-Statistiken
    |
    |-- NZBDav / NZBDavEx, mit serverseitigem API-Key
        |-- SAB-kompatible Queue-API
        |-- SAB-kompatible History-API
        |
        |-- nur beim eingebauten NZBDavEx:
            |-- Overview-Statistiken
            |-- Provider-Verbrauch
```

Der Browser spricht fuer diese Ansicht nicht direkt mit der Backend-API.
NZBStreamer sammelt und reduziert die Antworten und liefert nur die fuer das
Dashboard vorgesehenen Felder zurueck.

| Bereich | Quelle | Anfrage bzw. Herkunft |
|---|---|---|
| Backend-Modus | NZBStreamer | Zustand des eingebauten Backend-Managers |
| Queue und Queue-Anzahl | NZBDav/SAB-API | `api?mode=queue&output=json&start=0&limit=20` |
| History und History-Anzahl | NZBDav/SAB-API | `api?mode=history&output=json&start=...&limit=10&pageSize=10` |
| Active reads | Eingebautes NZBDavEx | `api/get-overview-stats?window=24h`, Feld `tiles.activeReads` |
| Data served / minute | Eingebautes NZBDavEx | Gleiche Overview-Antwort, Feld `tiles.bytesServedPerMinute` |
| Catalogue files und virtuelle Groesse | Eingebautes NZBDavEx | Gleiche Overview-Antwort, Felder `catalogue.fileCount` und `catalogue.totalBytes` |
| Provider usage | Eingebautes NZBDavEx | `api/get-provider-usage` |
| Alle drei Cache-Kacheln | NZBStreamer selbst | Lokale Cache-Module, keine Backend-Abfrage |

### Internes und externes Backend

**Built-in NZBDavEx:** Alle genannten Bereiche koennen Daten liefern.
Die Verbindung verwendet die vom eingebauten Backend verwaltete interne URL
und dessen API-Key. Gespeicherte externe Zugangsdaten ersetzen diese Verbindung
nicht.

**External NZBDav:** Queue und History werden ueber die konfigurierte externe
Verbindung abgefragt. Die erweiterten Overview- und Provider-Endpunkte werden
in diesem Modus absichtlich nicht abgefragt. Active reads, Data served / minute
und Catalogue files stehen dann auf `Unavailable`; im Provider-Bereich erscheint
ein entsprechender Hinweis. Die lokalen NZBStreamer-Caches bleiben verfuegbar.

Auch wenn ein externer Server zufaellig kompatible Erweiterungen anbietet,
nutzt das aktuelle Dashboard sie nicht automatisch.

## 3. Die sechs Kennzahlen

### Backend

Die Kachel zeigt:

- `Built-in NZBDavEx` oder `External NZBDav`: den eingestellten Betriebsmodus.
- `Responding`: Mindestens die Queue- oder History-Abfrage war erfolgreich.
- `Unavailable`: Keine dieser beiden Abfragen konnte erfolgreich ausgewertet
  werden.

`Responding` ist kein vollstaendiger Gesundheitscheck. Provider-Statistiken
koennen beispielsweise fehlschlagen, obwohl die Queue funktioniert. Ebenso
beweist es nicht, dass jeder Usenet-Artikel erreichbar oder jeder Stream
abspielbar ist. Eventuelle Teilfehler stehen oberhalb der Kacheln.

### Queued downloads

Das ist die vom Backend gemeldete **Gesamtzahl der Queue-Auftraege**.
Sie ist nicht die Zahl aktuell schauender Personen und nicht die Anzahl
heruntergeladener Filme.

Ein Eintrag entsteht, wenn eine NZB an NZBDavEx uebergeben wird und noch auf
Verarbeitung wartet oder gerade verarbeitet wird. Beim eingebauten Backend
werden wartende Eintraege und der aktuell bearbeitete Auftrag in der
Queue-Darstellung beruecksichtigt.

Beispiel:

1. Ein Stream wird ausgewaehlt und die benoetigte NZB ist noch nicht aufgenommen.
2. NZBDavEx nimmt den Auftrag an und verarbeitet ihn.
3. Kurzzeitig steht ein Eintrag in der Queue.
4. Nach Abschluss oder Fehlschlag wird der Auftrag in der History gefuehrt.
5. Die spaetere Wiedergabe kann laufen, waehrend die Queue wieder `0` zeigt.

Andere Clients, die dasselbe Backend verwenden, koennen ebenfalls Auftraege
erzeugen. Die Dashboard-Abfrage setzt keinen Kategorie- oder Profilfilter.

### History items

Das ist die **Gesamtzahl der History-Auftraege**, nicht nur die Anzahl der gerade
sichtbaren Zeilen. Auch fehlgeschlagene Auftraege koennen dazugehoeren.

`510` bedeutet also nicht 510 momentan laufende Downloads und auch nicht
zwingend 510 Filme: Ein Auftrag kann mehrere Dateien enthalten.

Ist Show failed aktiv, heisst die Kachel `Failed history items` und zaehlt
nur die fehlgeschlagenen Eintraege.

### Active reads

Diese Zahl kommt aus der aktiven WebDAV-Leseregistrierung des eingebauten
NZBDavEx.

Sie beschreibt registrierte Lesevorgaenge, nicht angemeldete Benutzer und nicht
zuverlaessig die Anzahl der Player. Aufeinanderfolgende Range-Anfragen desselben
Clients fuer denselben Pfad koennen zu einer Sitzung zusammengefasst werden;
ein Client kann gleichzeitig mehrere Dateien oder Verbindungen lesen.

Die Registrierung verwendet ein Aktivitaetsfenster von etwa **15 Sekunden**.
Die Overview-Kachel nutzt die Anzahl der registrierten Eintraege; die Bereinigung
abgelaufener Eintraege und das Dashboard-Polling verursachen zusaetzliche
Verzoegerungen.

Ein Player kann bereits gepufferte Daten abspielen, ohne gerade neue Bytes
anzufordern. Daher kann die Anzeige auch waehrend einer Wiedergabe `0` sein.
Nach einem Backend-Neustart beginnt diese In-Memory-Registrierung neu.

### Data served / minute

Das sind die vom Backend **an lesende Clients ausgelieferten Bytes im rollenden
Fenster von ungefaehr 60 Sekunden**.

- Die Backend-Messung wird etwa alle fuenf Sekunden aktualisiert.
- NZBStreamer liest den Wert beim Dashboard-Refresh.
- Es ist eine Datenmenge pro Zeitfenster, keine direkt angezeigte MiB/s-Rate.
- Es ist nicht der gesamte bisherige Provider-Verbrauch.
- Es ist auch nicht die Groesse der Datei, die gerade abgespielt wird.

Nach dem Stoppen eines Streams kann noch ein positiver Wert stehen, bis die
vorherige Aktivitaet aus dem Zeitfenster faellt. Deshalb sind beispielsweise
`Active reads: 0` und `Data served / minute: 109 MiB` kein Widerspruch.

Direkt nach dem Backend-Start kann der Wert zunaechst `0` sein, weil erst
Messpunkte fuer die Differenzbildung gesammelt werden muessen.

Der Parameter `window=24h` der Overview-Anfrage macht diese Kachel **nicht**
zu einem 24-Stunden-Zaehler. Das Dashboard verwendet daraus explizit den
Live-Wert fuer die letzte Minute.

### Catalogue files

Die Anzahl kommt aus den als `UsenetFile` gespeicherten Eintraegen im virtuellen
Dateikatalog von NZBDavEx. Darunter steht die Summe ihrer Dateigroessen.

Wichtig:

- Dateien sind nicht dasselbe wie History-Auftraege.
- Ein Auftrag kann mehrere Dateien liefern.
- Ordner werden in dieser Dateianzahl nicht mitgezaehlt.
- Die Groesse ist **virtuelle Dateigroesse, kein belegter Festplattenspeicher**.
- Ein grosser Katalog beweist weder, dass alle Daten lokal liegen, noch dass
  jeder zugehoerige Usenet-Artikel dauerhaft verfuegbar ist.

1703 Dateien mit 3,8 TiB bedeuten somit einen virtuellen Katalog dieses Umfangs,
nicht automatisch 3,8 TiB lokalen Speicherverbrauch.

## 4. Provider usage

Pro konfiguriertem Usenet-Provider zeigt das Dashboard:

| Anzeige | Bedeutung |
|---|---|
| Ueberschrift | Nickname, falls vorhanden; sonst Provider-Host |
| Datenmenge | Vom Backend erfasste verbrauchte Provider-Bytes |
| `Limit: ...` | Im Backend konfiguriertes Byte-Limit |
| `No byte limit` | Kein positives Byte-Limit im Backend konfiguriert |
| Fehlerhervorhebung | Backend meldet `overLimit` |

Der Verbrauch stammt aus dem Provider-Byte-Tracker. Der angezeigte Wert
beruecksichtigt den im Backend verwalteten Zaehlerstand und einen gegebenenfalls
konfigurierten Verbrauchs-Offset. Persistierte Metriken und die Reset-Konfiguration
werden vom Backend verwaltet.

Deshalb gilt:

- Kein reiner Tages-, Monats- oder Dashboard-Sitzungszaehler.
- Nicht auf den 24-Stunden-Parameter der Overview-Anfrage begrenzt.
- Keine Live-Abfrage beim Kundenkonto des Usenet-Anbieters.
- Andere Programme ausserhalb dieses Backends sind nicht automatisch erfasst.
  Ein Offset kann bereits anderweitig verbrauchte Daten beruecksichtigen.
- Verbrauch kann durch Streaming, Verarbeitung und andere Backend-Zugriffe
  entstehen; die Queue muss dafuer nicht gefuellt sein.
- Ein konfigurierter Reset oder Offset kann den angezeigten Stand veraendern.

Beim eingebauten Backend gilt aktuell eine Sicherheitsreserve:
`overLimit` kann bereits bei **95 % des konfigurierten Limits** gesetzt sein.
Das Dashboard uebernimmt dieses Backend-Signal und berechnet es nicht selbst.

`No byte limit` bedeutet nur, dass hier kein Limit gesetzt wurde. Es ist keine
Garantie fuer einen unbegrenzten Tarif beim Anbieter.

Provider-Verbrauch und Data served / minute sind nicht direkt vergleichbar:
Ersteres misst Upstream-Verbrauch gegen den Providerzaehler, Letzteres die
Downstream-Auslieferung im letzten Minutenfenster. Caches, wiederholte Reads und
zusaetzliche Backend-Arbeit koennen die Werte auseinanderlaufen lassen.

## 5. NZBStreamer caches

Diese drei Kacheln stammen aus **NZBStreamer**, nicht aus der NZBDavEx-Queue.
Sie zeigen keine lokal gespeicherte Filmsammlung.

### NZB payload disk cache

Speichert NZB-Inhalte auf dem Datentraeger, damit sie bei erneutem Bedarf
nicht nochmals vom Indexer heruntergeladen werden muessen.

Angezeigt werden:

- `entries`: Anzahl gespeicherter NZB-Payload-Eintraege.
- Aktuelle Payload-Datenmenge.
- Konfiguriertes maximales Byte-Budget, beispielsweise `6,7 MiB / 1,5 GiB`.

Die Grenze ist das Budget dieses Caches, nicht die Gesamtgroesse oder der freie
Speicherplatz der Festplatte. Die Datenmenge ist keine Messung des gesamten
Dateisystemverbrauchs inklusive aller Verwaltungsdaten.

Der Cache ist fuer Neustarts ausgelegt; in einem Container setzt das einen
weiterhin vorhandenen beziehungsweise persistent eingebundenen Cache-Speicher
voraus. Bereinigung, Ablaufregeln und Groessenlimits koennen Eintraege entfernen.

### Stream response cache

Speichert bereits erzeugte Stream-Antworten im Arbeitsspeicher, damit wiederholte
Stremio-Anfragen nicht jedes Mal dieselbe Ergebnisaufbereitung ausloesen.

Angezeigt werden:

- Anzahl gecachter Antworten.
- Geschaetzte Datenmenge der serialisierten Payloads samt Metadaten.

Die Byte-Anzeige ist **keine exakte Messung des JavaScript-Heap-Verbrauchs**.
Ein Eintrag kann mehrere Stream-Kandidaten enthalten und entspricht nicht
notwendigerweise einem Film oder einer Videodatei.

Dieser Cache enthaelt Antwortdaten, keine Videobloecke. Bei einem Prozessneustart
geht der In-Memory-Inhalt verloren.

### NZBDav stream cache

Speichert den Zustand beziehungsweise das Ergebnis der NZBDav-Stream-Aufloesung
im Arbeitsspeicher, damit bereits bearbeitete Anfragen wiederverwendet werden
koennen.

Angezeigt werden:

- Gesamtzahl der Eintraege.
- `ready`: Eintraege mit bereitem Ergebnis.
- `pending`: Eintraege mit noch ausstehender Verarbeitung.

Intern werden auch `failed`-Zustaende gezaehlt. Die aktuelle Kachel zeigt dafuer
keinen eigenen Zaehler; deshalb muessen `ready + pending` nicht immer der
Gesamtzahl entsprechen.

`ready` ist ein Cache-Zustand, keine Garantie fuer dauerhaft vollstaendige
Usenet-Verfuegbarkeit und kein Beweis fuer eine komplett lokal geladene Datei.
Ein Neustart leert diesen In-Memory-Cache.

### Wann aendern sich die Cache-Werte?

Wenn Anfragen neue Daten erzeugen, wachsen die Caches. Wiederverwendung
vorhandener Eintraege muss die Anzahl nicht erhoehen. Ablauf, Bereinigung,
manuelles Leeren oder Einstellungen koennen die Werte verringern.

Beim Speichern der Konfiguration werden die transienten Caches geleert; die
auf Datentraeger gespeicherten NZB-Payloads werden dabei bewusst behalten.

Die drei Kacheln sind keine vollstaendige Speicherbilanz. Weitere interne Caches
und der Speicherbedarf von Node.js oder NZBDavEx werden nicht als Summe gezeigt.

## 6. Download queue

Die Liste ist die Detailansicht zur Queue-Kennzahl.

Pro Eintrag werden angezeigt:

- Name aus `filename`.
- Status, beim eingebauten Backend normalerweise `Queued` oder `Downloading`.
- Kategorie; fehlt sie, steht `Uncategorized`.
- Fortschritt in Prozent und ein Fortschrittsbalken.

Der Fortschritt stammt bevorzugt aus `true_percentage`, ansonsten aus
`percentage`, und wird fuer die Anzeige auf 0 bis 100 begrenzt.
Das ist der vom Backend gemeldete **Auftragsfortschritt**, kein
Wiedergabefortschritt und keine Aussage darueber, wie viel eines Films dauerhaft
lokal gespeichert ist.

Die Anfrage fordert mit `start=0&limit=20` die ersten 20 Eintraege an. Die
Statuszeile beschreibt das als `Queue: up to 20 items`.
Die Queue hat aktuell keine eigene Pagination und im Gegensatz zur History
keine zusaetzliche serverseitige Abschneidung der Antwort. Bei Backends, die
mehr Slots zurueckliefern, ist dies daher keine harte Anzeigeobergrenze.
Die Kennzahl oben verwendet unabhaengig davon die gemeldete Gesamtzahl.

| Zustand | Anzeige |
|---|---|
| Erfolgreiche Abfrage, keine Auftraege | `No items.` |
| Queue-Quelle nicht verfuegbar | `Data unavailable. See errors above.` |
| Wartender Auftrag | Name, `Queued`, Kategorie, Backend-Fortschritt |
| Laufende Verarbeitung | Name, `Downloading`, Kategorie, Fortschrittsbalken |

Nicht angezeigt werden beispielsweise Queue-Steuerung, Pausieren, Loeschen,
Restzeit, individuelle Providerdetails oder eine genaue Transfergeschwindigkeit
pro Auftrag.

## 7. Recent history

Die History zeigt beim eingebauten Backend die Auftraege **absteigend nach
Erstellungszeit**. Es sind nicht ausschliesslich erfolgreiche Downloads.

Pro Eintrag werden angezeigt:

- Auftragsname aus `name`, ersatzweise `nzb_name`.
- Backend-Status, insbesondere `Completed` oder `Failed`.
- Kategorie oder `Uncategorized`.
- Die vom Backend gemeldete Byte-Groesse.
- Datum und Uhrzeit der History-Erstellung, in der lokalen Zeitzone des Browsers.
  Der Tooltip beschreibt die Bedeutung; das HTML-Zeitelement enthaelt den
  ISO-Zeitpunkt. Beim eingebauten Backend stammt er aus `HistoryItem.CreatedAt`,
  das beim Erzeugen des abgeschlossenen beziehungsweise fehlgeschlagenen
  History-Auftrags gesetzt wird, und wird als SAB-Feld `completed` geliefert.
  Die gespeicherte lokale Backend-Zeit wird mit dessen Zeitzone interpretiert.
  Ein spaeterer Zeitzonenwechsel des Backends kann die Interpretation alter
  Eintraege beeinflussen.
  Ein externer Server ohne gueltigen `completed`-Zeitstempel fuehrt zur Anzeige
  `Timestamp unavailable`; es wird kein Datum erfunden.

Bei NZBDavEx entspricht die Groesse dem Feld `TotalSegmentBytes` des
History-Auftrags. Sie ist keine Messung des fuer diesen Auftrag belegten
lokalen Plattenplatzes und keine separate Messung der bereits angesehenen Bytes.

**Completed** bedeutet einen erfolgreich abgeschlossenen Backend-Auftrag.
Im virtuellen NZBDavEx-Betrieb ist das nicht gleichbedeutend mit einer
vollstaendig lokal gespeicherten Videodatei. **Failed** bedeutet einen
fehlgeschlagenen Auftrag. Die aktuelle Dashboard-Zeile zeigt den Status,
aber nicht die ausfuehrliche Backend-Fehlerursache.

### Zehn Eintraege je Seite

- Seite 1: Eintraege 1 bis 10.
- Seite 2: Eintraege 11 bis 20.
- Bei 510 Eintraegen gibt es 51 Seiten.
- Die letzte Seite kann weniger als zehn Eintraege enthalten.
- Bei leerer History steht sinngemaess `Page 1 of 1 | 0-0 of 0 items`.
- Previous und Next sind an den Grenzen, beim Laden oder bei fehlenden
  History-Daten deaktiviert.

Die Pagination erfolgt auf dem Server. Die Anfrage verwendet sowohl `limit=10`
als auch `pageSize=10`, weil NZBDavEx je nach Einstellung das SAB-Argument
`limit` absichtlich ignorieren kann. Zusaetzlich begrenzt NZBStreamer die
ausgelieferten History-Eintraege auf maximal zehn.

Wird die ausgewaehlte Seite durch geloeschte History ungueltig, wird die letzte
verfuegbare Seite nachgeladen. Neue Auftraege koennen vorhandene Eintraege auf
spaetere Seiten verschieben: Es ist eine aktuelle, offsetbasierte Liste und kein
eingefrorener Verlauf.

Auch die History ist nicht nach dem ausgewaehlten NZBStreamer-Profil oder einer
bestimmten Kategorie gefiltert.

### Show failed

Der Toggle zeigt ausschliesslich Eintraege mit dem Status `Failed`.
Ausgeschaltet werden wieder alle Status angezeigt. Beim Umschalten beginnt
die Ansicht auf Seite 1. Der Filter bleibt bei automatischen Refreshs und
Seitenwechseln erhalten. Die Seitenanzahl bezieht sich auf die gefilterte Menge.

Beim eingebauten NZBDavEx wird mit `failed_only=1` bereits vor dem Zaehlen und
Paginieren in der Datenbank gefiltert. Bei externen Backends liest NZBStreamer
die History seitenweise, filtert auf dem Server und liefert erst danach die
gewuenschte Zehnerseite. Das kann bei grosser externer History aufwendiger sein.

### Clear history

Die Schaltflaeche verlangt eine Bestaetigung, bevor eine Loeschanfrage gesendet
wird. Sie loescht **alle History-Eintraege, erfolgreich und fehlgeschlagen**,
unabhaengig von Show failed oder der ausgewaehlten Seite.

- Die Aktion ist nicht rueckgaengig zu machen.
- Virtuelle Dateien bleiben erhalten: Die Backend-Anfragen verwenden
  `del_files=0` und `del_completed_files=0`.
- NZBStreamer liest zuerst die History-IDs und entfernt diese danach in Batches.
  Waehrenddessen neu hinzukommende Auftraege koennen erhalten bleiben.
- Die Aktion betrifft auch History anderer Clients oder Profile am selben Backend.
- History-basierte Kataloge und Such-/Wiederverwendungsfunktionen koennen sich
  durch die fehlenden History-Zeilen aendern, obwohl virtuelle Dateien bestehen.
- Backend-interne Bereinigung kann mit History verknuepfte Verwaltungsdaten
  entfernen; das ist kein Reset des Provider-Verbrauchs.
- Nach der Aktion wird neu geladen; bei Erfolg beginnt die Anzeige auf Seite 1.
- Ein Fehler wird ausdruecklich angezeigt, inklusive der bereits erfolgreich
  bestaetigten Anzahl entfernter Eintraege. Mehrere Batches bilden keine
  gemeinsame Transaktion. Bei einem Verbindungsabbruch kann der zuletzt
  angefragte Batch bereits verarbeitet worden sein, ohne dass seine Antwort
  angekommen ist.

Die Admin-API verwendet dafuer `POST /admin/api/dashboard/history/clear` mit
der expliziten Bestaetigung `{"confirm":"clear-all-history"}`.
Die GET-Abfrage des Dashboards loescht niemals History.

## 8. Fehler, leere Werte und Sicherheit

### Null ist nicht dasselbe wie nicht verfuegbar

| Anzeige | Bedeutung |
|---|---|
| `0` | Die Quelle hat erfolgreich einen Nullwert geliefert |
| `No items.` | Erfolgreiche Listenabfrage ohne Eintraege |
| `Unavailable` | Kein verwendbarer Wert fuer diese Kennzahl |
| `No providers configured.` | Erfolgreiche interne Provider-Abfrage ohne Provider |
| Fehlermeldung mit Quellenname | Eine bestimmte Teilabfrage ist fehlgeschlagen |

Die Quellen werden unabhaengig ausgewertet. Ein Fehler bei `providers` macht
eine erfolgreiche Queue nicht unbrauchbar. Lokale Cache-Statistiken koennen
auch dann angezeigt werden, wenn das Backend nicht erreichbar ist.

Moegliche Meldungen:

- `Backend returned HTTP 401`: Backend hat die Authentifizierung abgelehnt;
  das ist nicht automatisch ein Fehler der Admin-Anmeldung.
- `Backend request timed out`: Einzelne Backend-Abfrage hat das Zeitlimit von
  acht Sekunden erreicht.
- `Backend returned an unexpected response`: Antwort passt nicht zum erwarteten
  Datenformat.
- `Backend request failed`: Sonstiger Verbindungs- oder Verarbeitungsfehler.
- `NZBDav is not configured.`: URL oder API-Key fuer die Verbindung fehlt.

Wenn die gesamte Dashboard-Anfrage fehlschlaegt, koennen die bisher sichtbaren
Werte stehen bleiben. Die Statuszeile weist ausdruecklich darauf hin, dass sie
veraltet sein koennen. Schlaegt dagegen nur eine Quelle innerhalb einer
erfolgreichen Antwort fehl, wird deren Bereich als nicht verfuegbar dargestellt.

### Schutz der Verbindung

- Die Dashboard-API benoetigt eine angemeldete Admin-Sitzung.
- Der Backend-API-Key bleibt serverseitig.
- Antworten werden mit `Cache-Control: no-store` ausgeliefert; auch die
  Browser-Abfrage fordert keine Cache-Wiederverwendung an.
- Backend-Antworten werden auf erlaubte Dashboard-Felder reduziert.
- Interne Cache-Verzeichnisse und Backend-Zugangsdaten werden nicht ausgegeben.
- Upstream-Fehlertexte werden nicht ungefiltert weitergereicht.

Release-Namen, Kategorien und Provider-Namen sind dennoch sichtbare
Betriebsinformationen. Bei oeffentlich geteilten Screenshots sollte man sie
gegebenenfalls unkenntlich machen.

## 9. Einheiten und typische Missverstaendnisse

Groessen werden binaer formatiert:

| Einheit | Bytes |
|---|---:|
| KiB | 1.024 |
| MiB | 1.048.576 |
| GiB | 1.073.741.824 |
| TiB | 1.099.511.627.776 |

Die Darstellung verwendet maximal eine Nachkommastelle und die Spracheinstellung
des Browsers. Provider-Portale koennen stattdessen dezimale GB/TB anzeigen;
dadurch unterscheiden sich Zahlen auch bei derselben Byte-Menge.

| Beobachtung | Moegliche normale Erklaerung |
|---|---|
| Film laeuft, Queue ist leer | Auftrag bereits verarbeitet; Wiedergabe liest virtuelle Datei |
| Film laeuft, Active reads ist 0 | Player spielt Puffer ab; Messung ist zeitversetzt |
| Active reads 0, Daten/min noch positiv | Auslieferung der letzten Minute ist noch im rollenden Fenster |
| History waechst, Catalogue files waechst anders | Auftraege und Dateien sind unterschiedliche Einheiten; auch Fehler zaehlen zur History |
| Mehrere TiB im Katalog, kleiner lokaler Cache | Virtueller Katalog und lokale NZB-Payloads sind unterschiedliche Dinge |
| Provider-Verbrauch steigt bei Queue 0 | Streaming kann neue Usenet-Daten anfordern |
| ready + pending kleiner als Cache-Eintraege | Weitere Zustaende wie failed sind nicht separat in der Kachel dargestellt |
| Providerdaten fehlen im externen Modus | Erweiterte Endpunkte werden nur intern abgefragt |

## 10. Was derzeit nicht Teil des Dashboards ist

Die eingebettete NZBDavEx-API kann mehr Daten liefern, als NZBStreamer aktuell
anzeigt. Das Dashboard enthaelt insbesondere keine:

- CPU-, RAM-, freien Plattenplatz- oder Container-Auslastungsanzeigen.
- Exakte Player-/Benutzerliste oder Wiedergabepositionen.
- Vollstaendigen Transfer-, Fehler- oder Provider-Zeitreihendiagramme.
- Artikel-pro-Minute- oder Fehler-pro-Minute-Kacheln.
- Provider-Verbrauchsprognosen oder Resttage.
- Ausfuehrlichen History-Fehlertexte, Downloadpfade oder Indexerinformationen.
- Queue-Aktionen zum Pausieren, Fortsetzen oder Entfernen.
- Getrennten Statistiken je NZBStreamer-Profil.

Ein fehlender Wert in dieser Liste ist daher nicht zwingend ein Backend-Fehler,
sondern kann schlicht eine noch nicht integrierte Dashboard-Funktion sein.

## 11. Technische Referenzen

Die Beschreibung orientiert sich an diesen Implementierungen:

- [Dashboard-Markup](../admin/index.html)
- [Rendering, Formatierung, Polling und Seitenwechsel](../admin/app.js)
- [Dashboard-API und Datenaggregation](../src/services/adminDashboard.js)
- [Dashboard-Regressionstests](../src/services/adminDashboard.test.js)
- [Admin-API-Route](../server.js)
- [Interne Backend-Verbindung](../src/services/embeddedNzbdav.js)
- [Zentrale Cache-Statistiken](../src/cache/index.js)
- [Stream-Antwortcache](../src/cache/streamCache.js)
- [NZBDav-Streamcache](../src/cache/nzbdavCache.js)
- [NZB-Payload-Diskcache](../src/cache/diskNzbCache.js)
- [NZBDavEx Queue](../vendor/nzbdavex/backend/Api/SabControllers/GetQueue/GetQueueController.cs)
- [NZBDavEx History](../vendor/nzbdavex/backend/Api/SabControllers/GetHistory/GetHistoryController.cs)
- [History-Feldzuordnung](../vendor/nzbdavex/backend/Api/SabControllers/GetHistory/GetHistoryResponse.cs)
- [NZBDavEx Overview](../vendor/nzbdavex/backend/Api/Controllers/GetOverviewStats/GetOverviewStatsController.cs)
- [Aktive Lesevorgaenge](../vendor/nzbdavex/backend/Services/ActiveReadRegistry.cs)
- [Rollende Live-Messung](../vendor/nzbdavex/backend/Services/Metrics/LiveStatsBroadcaster.cs)
- [Provider-API](../vendor/nzbdavex/backend/Api/Controllers/GetProviderUsage/GetProviderUsageController.cs)
- [Provider-Verbrauch und Limits](../vendor/nzbdavex/backend/Services/Metrics/ProviderUsageHelper.cs)
