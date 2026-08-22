// Catalog behind the project icon picker (see IconPicker.tsx). Kept as a plain
// data module — deliberately not an emoji library — so the set stays curated
// (only glyphs that read well at 96px on a homescreen tile) and searchable in
// German, which is what the picker's users actually type.

export interface IconCategory {
  id: string;
  label: string;
  /** Each entry: the glyph plus space-separated German search terms. */
  icons: Array<[icon: string, keywords: string]>;
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: "entwicklung",
    label: "Entwicklung",
    icons: [
      ["💻", "laptop code entwicklung programmieren computer"],
      ["🖥", "monitor desktop rechner bildschirm"],
      ["⌨️", "tastatur keyboard tippen"],
      ["🧑‍💻", "entwickler developer coder programmierer"],
      ["🐛", "bug fehler debug käfer"],
      ["⚙️", "einstellung zahnrad config system"],
      ["🔧", "werkzeug schraubenschlüssel wartung tool"],
      ["🛠", "werkzeuge tools build bauen"],
      ["🧰", "werkzeugkasten toolbox utility"],
      ["🔩", "schraube hardware technik"],
      ["🧪", "test labor experiment versuch"],
      ["🧬", "dna forschung wissenschaft"],
      ["🔬", "mikroskop analyse forschung"],
      ["💾", "diskette speichern backup save"],
      ["📦", "paket package build artefakt release"],
      ["🐳", "docker wal container"],
      ["🐧", "linux pinguin server os"],
      ["🧩", "plugin modul erweiterung puzzle"],
      ["⚡", "blitz schnell performance energie"],
      ["🤖", "bot roboter automatik ki agent"],
    ],
  },
  {
    id: "web",
    label: "Web & Netz",
    icons: [
      ["🌐", "web internet netz global seite"],
      ["🕸", "netz spinnennetz web crawler"],
      ["📡", "antenne satellit api signal"],
      ["📶", "signal netz empfang mobil"],
      ["🔗", "link verknüpfung url kette"],
      ["☁️", "cloud wolke hosting server"],
      ["🛰", "satellit orbit netzwerk"],
      ["🔌", "stecker verbindung plugin strom"],
      ["🖇", "verbindung klammer anhang"],
      ["🌍", "erde welt global europa"],
    ],
  },
  {
    id: "daten",
    label: "Daten & Doks",
    icons: [
      ["📊", "diagramm statistik daten auswertung chart"],
      ["📈", "wachstum aktien trend steigend chart"],
      ["📉", "fallend verlust trend chart"],
      ["🗄", "archiv aktenschrank datenbank"],
      ["🗃", "kartei datenbank ablage"],
      ["🗂", "ordner register ablage sortierung"],
      ["📁", "ordner verzeichnis folder"],
      ["📂", "ordner offen verzeichnis"],
      ["📋", "liste klemmbrett aufgaben notizen"],
      ["📝", "notiz schreiben text dokument"],
      ["📄", "dokument datei seite text"],
      ["🧾", "rechnung beleg buchhaltung"],
      ["📚", "bücher wissen doku bibliothek"],
      ["🔍", "suche lupe finden analyse recherche"],
    ],
  },
  {
    id: "sicherheit",
    label: "Sicherheit",
    icons: [
      ["🔒", "schloss sicher gesperrt privat"],
      ["🔓", "offen entsperrt schloss"],
      ["🔐", "verschlüsselung schlüssel sicherheit"],
      ["🔑", "schlüssel zugang passwort key"],
      ["🗝", "schlüssel alt zugang"],
      ["🛡", "schild schutz firewall security"],
      ["🚨", "alarm warnung notfall sirene"],
      ["🧯", "feuerlöscher notfall incident"],
      ["👁", "auge überwachung monitoring beobachten"],
      ["🕵️", "detektiv audit untersuchung spion"],
    ],
  },
  {
    id: "medien",
    label: "Medien",
    icons: [
      ["🎨", "design farbe kunst gestaltung ui"],
      ["🖼", "bild galerie foto rahmen"],
      ["🎬", "film video klappe kino"],
      ["📷", "kamera foto bild"],
      ["🎵", "musik note audio ton"],
      ["🎧", "kopfhörer audio musik podcast"],
      ["🎙", "mikrofon podcast aufnahme sprache"],
      ["📺", "fernseher tv stream video"],
      ["🎮", "spiel gaming controller"],
      ["🕹", "joystick spiel retro arcade"],
    ],
  },
  {
    id: "kommunikation",
    label: "Kommunikation",
    icons: [
      ["💬", "chat nachricht sprechblase reden"],
      ["📨", "nachricht mail post senden"],
      ["📧", "email mail nachricht"],
      ["📬", "briefkasten post eingang"],
      ["📢", "lautsprecher ankündigung news"],
      ["🔔", "glocke benachrichtigung alarm"],
      ["📱", "handy smartphone mobil app"],
      ["☎️", "telefon anruf kontakt"],
      ["🤝", "zusammenarbeit team partner deal"],
      ["👥", "team gruppe nutzer personen"],
    ],
  },
  {
    id: "planung",
    label: "Planung & Zeit",
    icons: [
      ["📅", "kalender termin datum planung"],
      ["🗓", "kalender monat planung termine"],
      ["⏰", "wecker zeit erinnerung alarm"],
      ["⏱", "stoppuhr zeit messung dauer"],
      ["⌛", "sanduhr warten zeit"],
      ["🔁", "wiederholung schleife loop recurring"],
      ["✅", "erledigt fertig haken check"],
      ["📌", "pin merken wichtig anheften"],
      ["📍", "ort marker position"],
      ["🏁", "ziel fertig finish flagge"],
      ["🎯", "ziel treffer fokus target"],
      ["🧭", "kompass richtung navigation strategie"],
    ],
  },
  {
    id: "symbole",
    label: "Symbole",
    icons: [
      ["🚀", "rakete start launch schnell deploy"],
      ["🔥", "feuer heiß trending wichtig"],
      ["⭐", "stern favorit wichtig bewertung"],
      ["✨", "glanz neu magie highlight"],
      ["💡", "idee licht lampe einfall"],
      ["🧠", "gehirn ki denken intelligenz"],
      ["💎", "diamant wertvoll premium"],
      ["🏆", "pokal gewinner erfolg trophäe"],
      ["🪄", "zauberstab magie automatik"],
      ["🎲", "würfel zufall spiel glück"],
      ["❤️", "herz favorit liebe wichtig"],
      ["🌈", "regenbogen bunt vielfalt"],
      ["🌱", "pflanze wachstum neu start"],
      ["🌙", "mond nacht dunkel schlaf"],
      ["☀️", "sonne tag hell licht"],
      ["❄️", "schnee kalt winter frost"],
      ["🌊", "welle wasser fluss stream"],
      ["♻️", "recycling nachhaltig kreislauf"],
    ],
  },
  {
    id: "orte",
    label: "Orte & Transport",
    icons: [
      ["🏠", "haus zuhause home start"],
      ["🏢", "büro firma gebäude unternehmen"],
      ["🏭", "fabrik produktion industrie"],
      ["🏦", "bank geld finanzen"],
      ["🏪", "laden shop geschäft"],
      ["🗺", "karte plan übersicht map"],
      ["🚗", "auto fahrzeug fahren"],
      ["✈️", "flugzeug reise flug"],
      ["🚢", "schiff fracht transport"],
      ["🛸", "ufo experiment zukunft"],
    ],
  },
  {
    id: "tiere",
    label: "Tiere & Sonstiges",
    icons: [
      ["🦊", "fuchs firefox tier schlau"],
      ["🐙", "krake octopus git tier"],
      ["🦉", "eule nacht weise tier"],
      ["🐝", "biene fleißig tier arbeit"],
      ["🐞", "marienkäfer bug tier glück"],
      ["🦄", "einhorn magie besonders"],
      ["🐢", "schildkröte langsam tier"],
      ["🐈", "katze tier haustier"],
      ["🐕", "hund tier haustier"],
      ["☕", "kaffee pause energie"],
      ["🍕", "pizza essen food"],
      ["🍺", "bier feierabend pause"],
    ],
  },
];

const ALL_ENTRIES = ICON_CATEGORIES.flatMap((c) => c.icons);

/** Every glyph in the catalog, category order preserved. */
export const ALL_ICONS: string[] = ALL_ENTRIES.map(([icon]) => icon);

/**
 * Substring match over the German keywords. Typing an emoji itself also
 * matches it, so pasting a glyph from elsewhere finds its catalog entry
 * instead of coming up empty.
 */
export function searchIcons(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_ICONS;
  return ALL_ENTRIES.filter(([icon, keywords]) => icon === q || keywords.includes(q)).map(([icon]) => icon);
}
