# NZBStreamer - Theme-Farben

Farbpalette des aktuellen dunklen Gold-Themes.
Quelle: die zentralen CSS-Variablen in [admin/styles.css](../admin/styles.css).
Diese Datei ist eine Referenz, kein automatisch geladenes Stylesheet.

## Hauptfarben

| Verwendung | CSS-Variable | Farbwert |
|---|---|---|
| Hauptakzent / Gold | `--accent`, `--theme-primary` | `#e5a209` |
| Hellerer Akzent | `--accent-strong` | `#ebb55a` |
| Seitenhintergrund | `--bg-body`, `--theme-background` | `#0e0d0c` |
| Karten / Panels | `--bg-card`, `--bg-panel`, `--theme-surface` | `#1c1916` |
| Eingabefelder / dunkle Innenflaechen | `--bg-input` | `#14110e` |
| Dezenter Primaer-Container | `--theme-primary-container` | `#151311` |
| Erhoehte Flaechen / sekundaere Container | `--surface-raised`, `--theme-secondary`, `--theme-secondary-container` | `#241f1a` |
| Hover-Flaechen | `--surface-hover` | `#2a251f` |

`--theme-surface-variant` entspricht ebenfalls `#1c1916`.
`--theme-on-background` ist im aktuellen Theme Gold (`#e5a209`), nicht die
allgemeine Fliesstextfarbe.

## Textfarben

| Verwendung | CSS-Variable | Farbwert |
|---|---|---|
| Primaerer Text | `--text-primary`, `--theme-on-surface` | `#f5f0e8` |
| Sekundaerer Text | `--text-secondary` | `#cdc3b4` |
| Hinweise / zurueckhaltender Text | `--text-muted` | `#9c8f7f` |
| Hervorgehobene Werte / aktiver Seitentitel | `--accent` | `#e5a209` |

## Gold-Abstufungen

Die Variablenfamilien `--cffy-theme-primary-*` und `--cffy-theme-accent-*`
verwenden dieselben Farben.

| Stufe | Primary-Variable | Accent-Variable | Farbwert |
|---|---|---|---|
| Basis | `--cffy-theme-primary-a0` | `--cffy-theme-accent-a0` | `#e5a209` |
| 10 | `--cffy-theme-primary-a10` | `--cffy-theme-accent-a10` | `#e8ac3e` |
| 20 | `--cffy-theme-primary-a20` | `--cffy-theme-accent-a20` | `#ebb55a` |
| 30 | `--cffy-theme-primary-a30` | `--cffy-theme-accent-a30` | `#eebf72` |
| 40 | `--cffy-theme-primary-a40` | `--cffy-theme-accent-a40` | `#f1c888` |
| 50 | `--cffy-theme-primary-a50` | `--cffy-theme-accent-a50` | `#f3d29d` |

## Rahmen, transparente Akzente und Schatten

Die Prozentwerte beschreiben die Deckkraft. Das sichtbare Ergebnis haengt
vom darunterliegenden Hintergrund ab.

| Verwendung | CSS-Variable | Farbwert |
|---|---|---|
| Dezenter Rahmen | `--border-soft`, `--theme-outline` | `rgba(255, 255, 255, 0.08)` - Weiss, 8 % |
| Staerkerer Rahmen | `--border-strong` | `rgba(255, 255, 255, 0.16)` - Weiss, 16 % |
| Goldene Akzentlinie | `--line-strong` | `rgba(229, 162, 9, 0.4)` - Gold, 40 % |
| Goldene Hintergrundtoenung | `--accent-soft` | `rgba(229, 162, 9, 0.12)` - Gold, 12 % |
| Hintergrundschein | Bestandteil von `--bg-overlay` | `rgba(229, 162, 9, 0.08)` - Gold, 8 % |
| Weicher Schatten | `--shadow-soft` | `0 2px 10px rgba(0, 0, 0, 0.25)` |

### Verlaeufe

```css
--accent-gradient: linear-gradient(135deg, #e5a209, #ce8017);

--bg-overlay: radial-gradient(
  1100px 560px at 12% -8%,
  rgba(229, 162, 9, 0.08),
  transparent 60%
);
```

Der zweite Farbton des Akzentverlaufs ist `#ce8017`, ein dunkleres Orange-Gold.

## Statusfarben

| Status | Basis (`a0`) | Mittel (`a10`) | Hell (`a20`) |
|---|---|---|---|
| Erfolg / Success | `#13e83a` | `#69ee6f` | `#96f497` |
| Warnung / Warning | `#f0b01a` | `#f4c161` | `#f7d18d` |
| Fehler / Danger | `#ff312e` | `#ff6a5d` | `#ff9486` |
| Information / Info | `#2daaf7` | `#65bcfa` | `#8fcdfc` |

Die vollstaendigen Variablennamen lauten beispielsweise
`--cffy-theme-success-a0`, `--cffy-theme-warning-a10`,
`--cffy-theme-danger-a20` und `--cffy-theme-info-a10`.

Die kurzen semantischen Variablen verwenden jeweils die mittlere Stufe:

```css
--success: var(--cffy-theme-success-a10); /* #69ee6f */
--warning: var(--cffy-theme-warning-a10); /* #f4c161 */
--danger: var(--cffy-theme-danger-a10);   /* #ff6a5d */
```

Die Dashboard-Badges fuer `Completed` verwenden als komponentenspezifische
Abweichung ein gedaempftes Gruen:

- Text: `#8ed6a3`
- Rahmen: `rgba(142, 214, 163, 0.3)`
- Hintergrund: `rgba(142, 214, 163, 0.08)`

## Weitere neutrale Palette

| Variable | Aufgeloester Wert |
|---|---|
| `--cffy-theme-light-a0` | `#ffffff` |
| `--cffy-theme-dark-a0` | `#17110a` |
| `--cffy-theme-surface-a0` | `#0e0d0c` |
| `--cffy-theme-surface-a10` | `#1c1916` |
| `--cffy-theme-surface-a20` | `#241f1a` |
| `--cffy-theme-surface-a30` | `rgba(255, 255, 255, 0.08)` |
| `--cffy-theme-surface-a40` | `#4a4238` |
| `--cffy-theme-surface-a50` | `#6b6154` |
| `--cffy-theme-surface-tonal-a0` | `#151311` |
| `--cffy-theme-surface-tonal-a10` | `#241f1a` |
| `--cffy-theme-surface-tonal-a20` | `#241f1a` |
| `--cffy-theme-surface-tonal-a30` | `rgba(255, 255, 255, 0.08)` |
| `--cffy-theme-surface-tonal-a40` | `#6b6154` |
| `--cffy-theme-surface-tonal-a50` | `#857a6b` |

## Verwendung im UI

- **Gold:** aktive Navigation, Seitentitel hinter `/`, Icons, wichtige Werte,
  Toggle-Aktivzustand und dezente Akzentlinien.
- **Helles Cremeweiss:** gut lesbare Haupttexte.
- **Beige / Braun-Grau:** Beschreibungen, Metadaten und untergeordnete Hinweise.
- **Dunkle warme Flaechen:** Abstufung zwischen Seite, Karten und Eingabefeldern.
- **Gruen, Orange und Rot:** semantische Statusmeldungen statt rein dekorativer
  Hervorhebung.

Bei neuen Komponenten moeglichst die semantischen Variablen wie `--accent`,
`--text-primary` und `--bg-input` verwenden, statt Farbwerte erneut fest
einzutragen.

Diese Referenz beschreibt die zentrale Palette und die genannten Dashboard-
Abweichungen. Das bestehende Stylesheet enthaelt daneben komponentenspezifische
und aeltere Farbdeklarationen; die Datei ist kein Inventar jeder einzelnen
CSS-Farbverwendung.
