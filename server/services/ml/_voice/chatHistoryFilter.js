'use strict';
//
// [2026-11-02] Ce e CONVERSATIE si ce e comentariu.
//
// Intrebarea operatorului: "i raspunde manual long etc de ce". Raspunsul:
// `tradeReaction.js` isi scria reactiile la tranzactiile lui manuale
// (`manual LONG BTCUSDT. watching.`, `nice manual SHORT on BNBUSDT!`) cu
// `utterance_type = 'CHAT_REPLY'` — acelasi tip ca raspunsurile din chat.
//
// Masurat pe contul lui: din 322 de randuri `CHAT_REPLY`, **262 erau reactii**
// (`template_id = 'omega_reaction'`) si doar 60 conversatie adevarata. Adica
// 81 la suta din "chatul" lui era OMEGA comentandu-i tranzactiile.
//
// Costul nu era doar cosmetic:
//   • panoul numara 52 de mesaje care nu erau mesaje;
//   • fiecare reactie aparea ca raspuns la o intrebare inexistenta, de unde
//     randurile "(?)" din interfata;
//   • si, cel mai rau, memoria conversatiei trimisa modelului se umplea de
//     replici fara intrebare — un model care vede zece replici orfane raspunde
//     exact asa cum s-a plans el: trangă-langa.
//
// Tipul corect exista deja si era folosit in alta parte: REACTION.
// Randurile vechi raman gresit tipizate, deci filtrul prinde SI dupa
// `template_id` — asa se curata trecutul fara migratie.

/** Sabloanele scrise de tradeReaction. */
const REACTION_TEMPLATE_ID = 'omega_reaction';

/**
 * Fragment SQL pentru `WHERE`. Un singur loc, ca cele trei interogari care-l
 * folosesc (memoria conversatiei, panoul, numaratoarea) sa nu poata ajunge sa
 * spuna lucruri diferite despre acelasi istoric.
 */
const REAL_CHAT_SQL = "utterance_type = 'CHAT_REPLY' AND (template_id IS NULL OR template_id <> '" + REACTION_TEMPLATE_ID + "')";

/** Varianta pura, pentru cand randurile sunt deja in memorie. */
function isRealChatRow(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.utterance_type != null && row.utterance_type !== 'CHAT_REPLY') return false;
    return row.template_id !== REACTION_TEMPLATE_ID;
}

module.exports = { REACTION_TEMPLATE_ID, REAL_CHAT_SQL, isRealChatRow };
