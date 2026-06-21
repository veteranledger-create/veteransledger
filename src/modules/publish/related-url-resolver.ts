// Maps a related_records entry's `type` to the URL prefix that type's
// record pages actually live at. Real letter data's related_records aren't
// all same-type — british.json's letters point at Campaigns, for example —
// so a single same-type guess (which is all Phase 0 needed for the
// german-only pilot) isn't enough once all six collections are involved.
// Anything unrecognized — including the nation-collection labels real
// letter data also uses today, e.g. "German Collection" — falls back to
// /letters/<id>, since every same-type letter-to-letter reference observed
// in real data behaves that way.
const TYPE_TO_PATH: Record<string, string> = {
  Campaign: "/campaigns",
  Personnel: "/personnel",
  Armament: "/armaments",
  Formation: "/formations",
  Article: "/articles",
  Letter: "/letters",
};

export function resolveRelatedUrl(type: string | undefined, id: string): string {
  const prefix = (type && TYPE_TO_PATH[type]) || "/letters";
  return `${prefix}/${id}`;
}
