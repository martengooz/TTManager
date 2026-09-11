/*
 * Translation. Keys are the English strings themselves, so untranslated text
 * still reads correctly and a new language is just another dictionary.
 *
 * Placeholders look like {name} and are filled from the second argument.
 */

const SV = {
  // Shell and start screen
  "TT Manager": "TT Manager",
  "Set up a table tennis tournament, record every score, print the whole thing.":
    "Lägg upp en bordtennisturnering, registrera varje resultat, skriv ut alltihop.",
  "New tournament": "Ny turnering",
  "Import file": "Importera fil",
  "Install app": "Installera appen",
  "Settings": "Inställningar",
  "Your tournaments": "Dina turneringar",
  "No tournaments yet": "Inga turneringar än",
  "Create one, add your players, and TT Manager draws the groups and the bracket for you. Everything is stored in this browser — it keeps working offline.":
    "Skapa en, lägg till spelarna, så lottar TT Manager grupper och slutspel åt dig. Allt sparas i den här webbläsaren och fungerar utan uppkoppling.",
  "Create your first tournament": "Skapa din första turnering",
  "Scores follow the standard rules: sets to 11, win by two, best of 3/5/7. Install the app from your browser menu to use it courtside without a connection.":
    "Resultaten följer vanliga regler: set till 11, vinst med två bollar, bäst av 3/5/7. Installera appen från webbläsarens meny för att använda den vid bordet utan uppkoppling.",
  "not drawn": "ej lottad",
  "All tournaments": "Alla turneringar",
  "More": "Mer",
  "More actions": "Fler åtgärder",
  "More actions for {name}": "Fler åtgärder för {name}",
  "Print / Save as PDF": "Skriv ut / spara som PDF",
  "Export as JSON": "Exportera som JSON",
  "Duplicate tournament": "Duplicera turneringen",
  "Delete tournament": "Ta bort turneringen",
  "Duplicate": "Duplicera",
  "Delete": "Ta bort",
  "{done} of {total} played — tap to see what is left":
    "{done} av {total} spelade — tryck för att se vad som återstår",

  // Tabs
  "Setup": "Turnering",
  "Matches": "Matcher",
  "Standings": "Tabell",
  "Bracket": "Slutspel",
  "Print": "Utskrift",

  // Formats
  "Round robin": "Alla möter alla",
  "Everyone plays everyone. Final placing from the table.":
    "Alla möter alla. Slutplaceringen avgörs av tabellen.",
  "Groups + knockout": "Grupper + slutspel",
  "Groups + KO": "Grupper + slutspel",
  "Group stage, then the best advance to a knockout bracket.":
    "Gruppspel, sedan går de bästa vidare till slutspel.",
  "Knockout": "Utslagsspel",
  "Straight single-elimination bracket.": "Rakt utslagsspel.",

  // Setup screen
  "Details": "Uppgifter",
  "Tournament name": "Turneringens namn",
  "Date and venue": "Datum och plats",
  "Date": "Datum",
  "Venue": "Plats",
  "Sports hall": "Sporthall",
  "Club championship": "Klubbmästerskap",
  "Format": "Format",
  "Match length": "Matchlängd",
  "Best of {n} (first to {sets})": "Bäst av {n} (först till {sets})",
  "Points per set": "Poäng per set",
  "{n} points": "{n} poäng",
  "Number of groups": "Antal grupper",
  "{n} group": "{n} grupp",
  "{n} groups": "{n} grupper",
  "Advance per group": "Vidare per grupp",
  "Top {n}": "Topp {n}",
  "Double round robin (everyone plays everyone twice)":
    "Dubbelmöten (alla möter alla två gånger)",
  "Play a third place match": "Spela bronsmatch",
  "Draw the tournament": "Lotta turneringen",
  "Draw again": "Lotta om",
  "Go to matches": "Till matcherna",
  "Go to setup": "Till turneringen",
  "Add at least two players first.": "Lägg till minst två spelare först.",
  "Drawing again clears every score that has been recorded.":
    "En ny lottning raderar alla resultat som har registrerats.",
  "{n} player was added after the draw — draw again to include them.":
    "{n} spelare lades till efter lottningen — lotta om för att få med hen.",
  "{n} players were added after the draw — draw again to include them all.":
    "{n} spelare lades till efter lottningen — lotta om för att få med alla.",
  "{n} players → bracket of {size}.": "{n} spelare → slutspel med {size} platser.",
  "{n} players → bracket of {size} with {byes} byes.":
    "{n} spelare → slutspel med {size} platser och {byes} frilotter.",
  "{groups} · {matches} group matches.": "{groups} · {matches} gruppmatcher.",
  "{groups} · {matches} group matches, then a knockout for the top {advance} of each group.":
    "{groups} · {matches} gruppmatcher, sedan slutspel för de {advance} bästa i varje grupp.",
  "Players": "Spelare",
  "Add player — name, club": "Lägg till spelare — namn, klubb",
  "Player name, optionally followed by a comma and a club":
    "Spelarens namn, följt av komma och klubb om du vill",
  "Add": "Lägg till",
  "Enter adds. Paste a list to add several at once — one per line.":
    "Enter lägger till. Klistra in en lista för att lägga till flera på en gång — en per rad.",
  "No players yet. Type a name, or paste a list.":
    "Inga spelare än. Skriv ett namn eller klistra in en lista.",
  "Rename {name}": "Byt namn på {name}",
  "Remove {name}": "Ta bort {name}",
  "Added {n} players": "Lade till {n} spelare",
  "Changing the format clears the current draw and every score recorded so far. Continue?":
    "Att byta format raderar lottningen och alla resultat som registrerats. Fortsätta?",
  "Removing a player clears the current draw and every score recorded so far. Continue?":
    "Att ta bort en spelare raderar lottningen och alla resultat som registrerats. Fortsätta?",
  "Drawing again clears the current draw and every score recorded so far. Continue?":
    "En ny lottning raderar lottningen och alla resultat som registrerats. Fortsätta?",
  "Draw complete": "Lottningen klar",

  // Matches screen
  "All": "Alla",
  "To play": "Att spela",
  "Played": "Spelade",
  "All groups": "Alla grupper",
  "Search player or number": "Sök spelare eller nummer",
  "Nothing here with the current filter.": "Inget här med det valda filtret.",
  "Nothing matches “{query}”.": "Inget matchar ”{query}”.",
  "Nothing drawn yet": "Inget är lottat än",
  "Add your players on the setup screen and draw the tournament to get a schedule.":
    "Lägg till spelarna under Turnering och lotta för att få ett spelschema.",
  "Enter score": "Fyll i resultat",
  "Edit": "Ändra",
  "bye": "frilott",
  "w/o": "wo",
  "Bye": "Frilott",
  "TBD": "Ej klart",

  // Rounds
  "Final": "Final",
  "Semi-finals": "Semifinaler",
  "Quarter-finals": "Kvartsfinaler",
  "Round of 16": "Åttondelsfinaler",
  "Round of 32": "Sextondelsfinaler",
  "Round of {n}": "Omgång med {n}",
  "Third place": "Bronsmatch",
  "Group": "Grupp",
  "Group {letter}": "Grupp {letter}",
  "Match": "Match",
  "Winner {round} {n}": "Vinnare {round} {n}",
  "Loser {round} {n}": "Förlorare {round} {n}",
  "{rank} {group}": "{rank} {group}",
  "Knockout results": "Slutspelsresultat",
  "Knockout bracket": "Slutspelsträd",
  "No knockout stage": "Inget slutspel",
  "This tournament is decided on the group table. Switch the format on the setup screen to add a bracket.":
    "Den här turneringen avgörs i tabellen. Byt format under Turnering för att lägga till slutspel.",
  "See standings": "Visa tabellen",
  "Open bracket": "Öppna slutspelet",
  "Bracket places fill in automatically as each group finishes.":
    "Slutspelsplatserna fylls i automatiskt när varje grupp är färdigspelad.",
  "Tap any match to record or edit its score.":
    "Tryck på en match för att fylla i eller ändra resultatet.",

  // Standings
  "No group tables": "Inga grupptabeller",
  "This is a straight knockout — see the bracket for who is still in.":
    "Det här är rent utslagsspel — se slutspelet för vilka som är kvar.",
  "Draw the tournament first and the tables appear here.":
    "Lotta turneringen först, så dyker tabellerna upp här.",
  "Final placings": "Slutplaceringar",
  "Table": "Tabell",
  "Results grid": "Inbördes möten",
  "{group} — results grid": "{group} — inbördes möten",
  "Player": "Spelare",
  "Matches played": "Spelade matcher",
  "Wins": "Vinster",
  "Losses": "Förluster",
  "Sets won-lost": "Vunna–förlorade set",
  "Points won-lost": "Vunna–förlorade bollar",
  "Table points: 2 for a win, 1 for a loss": "Tabellpoäng: 2 för vinst, 1 för förlust",
  "P": "S",
  "W": "V",
  "L": "F",
  "Sets": "Set",
  "Points": "Bollar",
  "Pts": "P",
  "Q": "K",
  "complete": "klar",
  "No players in this group yet.": "Inga spelare i den här gruppen än.",
  "Ranking: table points (2 for a win, 1 for a loss, 0 for a walkover loss), then the results between the tied players, then set ratio, then point ratio.":
    "Ordning: tabellpoäng (2 för vinst, 1 för förlust, 0 för förlust på walkover), sedan inbördes möten, sedan setkvot, sedan bollkvot.",

  // Score dialog
  "Best of {n} · first to {points}, win by two": "Bäst av {n} · först till {points}, vinst med två",
  "Best of {n} · first to {points}, win by two · {left} more to play":
    "Bäst av {n} · först till {points}, vinst med två · {left} kvar att spela",
  "Set {n}": "Set {n}",
  "Set {n}, {player}": "Set {n}, {player}",
  "Type the loser's points and the winning score fills itself. Enter {points} or more and the other side is up to you. Enter moves on.":
    "Skriv förlorarens bollar så fylls vinnarsiffran i. Skriver du {points} eller mer får du fylla i andra sidan själv. Enter går vidare.",
  "Enter the points for each set.": "Fyll i bollarna för varje set.",
  "{player} wins {won}–{lost}": "{player} vinner {won}–{lost}",
  "Save": "Spara",
  "Save & next ›": "Spara & nästa ›",
  "Save and open {a} v {b}": "Spara och öppna {a} mot {b}",
  "Close": "Stäng",
  "Clear": "Rensa",
  "w/o {player}": "wo {player}",
  "Result saved": "Resultatet sparat",
  "Result cleared": "Resultatet rensat",
  "Walkover recorded": "Walkover registrerad",
  "That score is not a complete, legal result yet.":
    "Det där är inte ett komplett och giltigt resultat än.",
  "Every match that can be played is done.": "Alla matcher som går att spela är färdiga.",
  "v": "mot",

  // Rules feedback from the model
  "Enter at least one set.": "Fyll i minst ett set.",
  "The match was already decided after set {n}. Remove the extra sets.":
    "Matchen var redan avgjord efter set {n}. Ta bort de extra seten.",
  "Set {n} ({a}-{b}) is not a legal score: first to {points}, win by two.":
    "Set {n} ({a}-{b}) är inte ett giltigt resultat: först till {points}, vinst med två.",
  "Best of {n}: someone needs {target} sets to win (currently {a}-{b}).":
    "Bäst av {n}: någon behöver {target} set för att vinna (nu {a}-{b}).",
  "Match not found.": "Matchen hittades inte.",
  "Pick the player who advances.": "Välj spelaren som går vidare.",

  // Print sheet
  "Back": "Tillbaka",
  "Player list": "Spelarlista",
  "Group tables": "Grupptabeller",
  "Results grids": "Inbördes möten",
  "Match cards with scores": "Matchkort med resultat",
  "Match list (compact)": "Matchlista (kompakt)",
  "All matches": "Alla matcher",
  "Stage": "Del",
  "Set scores": "Setsiffror",
  "{n} players": "{n} spelare",
  "{done}/{total} matches played": "{done}/{total} matcher spelade",
  "Best of {n} to {points}": "Bäst av {n} till {points}",
  "Printed {when}": "Utskrivet {when}",

  // Umpire scorecards
  "Umpire scorecards": "Matchprotokoll",
  "Matches to print": "Matcher att skriva ut",
  "Ready to play": "Kan spelas nu",
  "Still to play": "Kvar att spela",
  "Player {n}": "Spelare {n}",
  "Cards per page": "Protokoll per sida",
  "Table": "Bord",
  "Match {n}": "Match {n}",
  "Set": "Set",
  "Sets won": "Vunna set",
  "Winner": "Vinnare",
  "Winner's signature": "Vinnarens namnteckning",
  "Umpire": "Domare",
  "Umpire's signature": "Domarens namnteckning",
  "Hand this to the organiser after the match.": "Lämna det här till tävlingsledningen efter matchen.",
  "Nothing to print": "Inget att skriva ut",
  "No match fits that choice — every one either has a result or is waiting on an earlier round.":
    "Ingen match passar det valet — alla har antingen ett resultat eller väntar på en tidigare omgång.",
  "Draw the tournament first and the scorecards appear here.":
    "Lotta turneringen först, så dyker protokollen upp här.",

  // Settings dialog
  "Language": "Språk",
  "Automatic": "Automatiskt",
  "Following the browser: {language}": "Följer webbläsaren: {language}",
  "English": "English",
  "Swedish": "Svenska",
  "View": "Vy",
  "Power user": "Expert",
  "Standard": "Standard",
  "Power user packs more on screen. Standard gives everything more room.":
    "Expert visar mer på skärmen. Standard ger allt mer luft.",
  "Score entry": "Resultatinmatning",
  "Fill in the score the rules imply": "Fyll i resultatet som reglerna ger",
  "Enter moves on to the next score": "Enter går vidare till nästa siffra",
  "Open the next unplayed match after saving": "Öppna nästa ospelade match efter sparande",
  "Matches are often reported out of order, so this is off by default.":
    "Matcher rapporteras ofta i annan ordning, så det här är avstängt från början.",
  "Done": "Klart",
  "Settings saved": "Inställningarna sparade",

  // Storage and files
  "Imported {n} tournament": "Importerade {n} turnering",
  "Imported {n} tournaments": "Importerade {n} turneringar",
  "Could not read that file.": "Kunde inte läsa den filen.",
  "That file does not look like a TT Manager tournament.":
    "Filen ser inte ut att vara en TT Manager-turnering.",
  "Copy created": "Kopia skapad",
  "Tournament deleted": "Turneringen borttagen",
  "Delete “{name}” and all its scores? This cannot be undone.":
    "Ta bort ”{name}” och alla dess resultat? Det går inte att ångra.",
  "Saving failed — the browser storage may be full or blocked.":
    "Det gick inte att spara — webbläsarens lagring kan vara full eller blockerad.",
  "Installed — look for TT Manager on your home screen":
    "Installerad — leta efter TT Manager på hemskärmen",
  "{n} players · {format}": "{n} spelare · {format}",
  "Tournament {date}": "Turnering {date}",
};

const DICTIONARIES = { en: {}, sv: SV };
export const LANGUAGES = [
  { id: "auto", label: "Automatic" },
  { id: "en", label: "English" },
  { id: "sv", label: "Swedish" },
];

const LOCALES = { en: "en-GB", sv: "sv-SE" };

let language = "en";

/** Picks the browser's language when the user has not chosen one. */
export function detectLanguage() {
  const candidates = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  const match = candidates.find((tag) => tag && DICTIONARIES[String(tag).slice(0, 2).toLowerCase()]);
  return match ? String(match).slice(0, 2).toLowerCase() : "en";
}

export function setLanguage(choice) {
  language = choice && choice !== "auto" && DICTIONARIES[choice] ? choice : detectLanguage();
  document.documentElement.lang = language;
  return language;
}

export function currentLanguage() {
  return language;
}

export function locale() {
  return LOCALES[language] || LOCALES.en;
}

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

/** Translates `key`, falling back to the key itself, then fills placeholders. */
export function t(key, vars) {
  const dictionary = DICTIONARIES[language] || {};
  return fill(dictionary[key] || key, vars);
}

/** Swedish writes 1:a, 2:a, 3:e; English 1st, 2nd, 3rd. */
export function ordinal(n) {
  if (language === "sv") {
    const teen = n % 100 >= 11 && n % 100 <= 12;
    return `${n}:${!teen && (n % 10 === 1 || n % 10 === 2) ? "a" : "e"}`;
  }
  const suffix = ["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th";
  return `${n}${suffix}`;
}
