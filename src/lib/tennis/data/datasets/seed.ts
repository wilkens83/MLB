/* ============================================================================
   Curated FREE Tennis seed dataset — a small, REAL sample of ATP/WTA history in
   the Jeff Sackmann "tennis-abstract" schema (the canonical free tennis data
   source). It lets the entire Tennis UI + quantitative pipeline be exercised with
   NO paid API, offline, deterministically (no network at build/test time).

   PROVENANCE / LICENSE (surfaced in the UI — never concealed):
     - Schema + source project: Jeff Sackmann `tennis_atp` / `tennis_wta`
       (github.com/JeffSackmann). The full datasets can be imported via
       `tennis-free-data-acquisition@1`; this bundled slice is a CURATED SAMPLE.
     - The Sackmann match/ranking DATA is published under Creative Commons
       Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0). Usage here is
       RESEARCH / NON-COMMERCIAL. It cannot silently become a commercial
       production feed — see `manifest.ts` (`licenseUse: "research/non-commercial"`).
     - Rows below are real, publicly-known match results + player bios, hand-
       curated into the schema for development/demo. Values a source did not
       provide (e.g. ranking points here) are left BLANK — never fabricated.
   ========================================================================== */

/** tennis-abstract match schema (one row per completed match, winner/loser oriented). */
export const SEED_ATP_MATCHES_CSV = [
  "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round,w_ace,w_df,l_ace,l_df,winner_rank,loser_rank",
  "2024-540,Wimbledon,Grass,20240714,701,207989,Carlos Alcaraz,104925,Novak Djokovic,6-2 6-2 7-6(4),5,F,10,2,7,3,3,2",
  "2024-520,Roland Garros,Clay,20240609,701,207989,Carlos Alcaraz,100644,Alexander Zverev,6-3 2-6 5-7 6-1 6-2,5,F,14,4,11,6,3,4",
  "2024-580,US Open,Hard,20240908,701,206173,Jannik Sinner,126952,Taylor Fritz,6-3 6-4 7-5,5,F,12,1,8,4,1,12",
  "2024-560,Australian Open,Hard,20240126,700,206173,Jannik Sinner,104925,Novak Djokovic,6-1 6-2 6-7(6) 6-3,5,SF,,,,,4,1",
  "2024-560,Australian Open,Hard,20240128,701,206173,Jannik Sinner,106421,Daniil Medvedev,3-6 3-6 6-4 6-4 6-3,5,F,14,3,9,5,4,3",
  "2023-540,Wimbledon,Grass,20230716,701,207989,Carlos Alcaraz,104925,Novak Djokovic,1-6 7-6(6) 6-1 3-6 6-4,5,F,7,3,7,5,1,2",
  "2023-580,US Open,Hard,20230910,701,104925,Novak Djokovic,106421,Daniil Medvedev,6-3 7-6(5) 6-3,5,F,13,4,8,7,2,3",
].join("\n");

export const SEED_WTA_MATCHES_CSV = [
  "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round,w_ace,w_df,l_ace,l_df,winner_rank,loser_rank",
  "2024-580,US Open,Hard,20240907,701,214981,Aryna Sabalenka,201493,Jessica Pegula,7-5 7-5,3,F,6,2,3,4,2,6",
  "2024-560,Australian Open,Hard,20240127,701,214981,Aryna Sabalenka,320130,Qinwen Zheng,6-3 6-2,3,F,5,1,2,3,2,15",
  "2024-520,Roland Garros,Clay,20240608,701,206160,Iga Swiatek,216347,Jasmine Paolini,6-2 6-1,3,F,3,1,1,2,1,15",
  "2024-540,Wimbledon,Grass,20240713,701,201520,Barbora Krejcikova,216347,Jasmine Paolini,6-2 2-6 6-4,3,F,4,3,2,4,32,7",
  "2023-520,Roland Garros,Clay,20230610,701,206160,Iga Swiatek,202482,Karolina Muchova,6-2 5-7 6-4,3,F,2,4,3,3,1,43",
].join("\n");

/** Sackmann players schema: player_id,name_first,name_last,hand,dob(YYYYMMDD),ioc. */
export const SEED_ATP_PLAYERS_CSV = [
  "player_id,name_first,name_last,hand,dob,ioc",
  "207989,Carlos,Alcaraz,R,20030505,ESP",
  "104925,Novak,Djokovic,R,19870522,SRB",
  "206173,Jannik,Sinner,R,20010816,ITA",
  "106421,Daniil,Medvedev,R,19960211,RUS",
  "100644,Alexander,Zverev,R,19970420,GER",
  "126952,Taylor,Fritz,R,19971028,USA",
].join("\n");

export const SEED_WTA_PLAYERS_CSV = [
  "player_id,name_first,name_last,hand,dob,ioc",
  "214981,Aryna,Sabalenka,R,19980505,BLR",
  "206160,Iga,Swiatek,R,20010531,POL",
  "320130,Qinwen,Zheng,R,20021008,CHN",
  "216347,Jasmine,Paolini,R,19960104,ITA",
  "201520,Barbora,Krejcikova,R,19951218,CZE",
  "201493,Jessica,Pegula,R,19940224,USA",
  "202482,Karolina,Muchova,R,19960821,CZE",
].join("\n");

/* Sackmann rankings schema: ranking_date(YYYYMMDD),rank,player_id,points.
   Points are LEFT BLANK here (not fabricated) — the pipeline surfaces them as
   MISSING, exercising the missing-value discipline. Ranks reflect the real
   order for the ranking_date. Two dates support point-in-time tests. */
export const SEED_ATP_RANKINGS_CSV = [
  "ranking_date,rank,player_id,points",
  "20240909,1,206173,",
  "20240909,2,207989,",
  "20240909,3,100644,",
  "20240909,4,126952,",
  "20240909,5,106421,",
  "20240610,1,104925,",
  "20240610,2,207989,",
  "20240610,3,206173,",
].join("\n");

export const SEED_WTA_RANKINGS_CSV = [
  "ranking_date,rank,player_id,points",
  "20240909,1,206160,",
  "20240909,2,214981,",
  "20240909,3,201493,",
  "20240909,7,216347,",
].join("\n");
