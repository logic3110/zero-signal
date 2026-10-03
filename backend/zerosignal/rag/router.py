"""Domain router (US-4.4): medical / survival / vehicle / other.

A lexicon vote, corroborated by retrieval. A query that hits no domain
vocabulary and retrieves nothing convincing is "other". Only a query matching
OUT_OF_SCOPE is declined as off-topic; other "other" queries are gated as
not-in-library, because retrieval confidence cannot tell an off-topic question
from an on-topic one the library covers poorly (e.g. a misspelled hazard).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..text import normalize, stem, words

LEXICON: dict[str, set[str]] = {
    "medical": set(
        """
        pain hurt hurts bleed bleeding blood wound cut burn burns burnt breath breathe breathing
        breathless choke choking unconscious faint fainted fever temperature injury injured bite
        bitten sting stung pregnant pregnancy labour labor baby infant child kid elderly fracture
        broken bone sprain heart chest stroke seizure fit fits convulsion diabetic diabetes sugar
        insulin asthma inhaler allergy allergic anaphylaxis swelling rash poison poisoned overdose
        vomit vomiting diarrhoea diarrhea dehydrated dehydration ors headache dizzy concussion
        spine neck head eye tooth teeth dental cpr pulse shock hypothermia frostbite heatstroke
        altitude ams hape hace drown drowning electric electrocuted snake scorpion dog rabies
        paracetamol aspirin medicine medication tablet dose doctor hospital ambulance patient
        casualty victim triage infection pus splint bandage tourniquet panic anxiety suicidal
        suicide unresponsive collapsed stomach abdomen skin nose nosebleed ankle knee wrist
        shoulder leg arm hand foot finger toe twisted sprained swollen bruise bruised cramp fell fall
        """.split()
    ),
    "survival": set(
        """
        water purify purification boil filter fire firewood shelter tent lost trek trekking hike
        hiking camp camping forest jungle desert mountain snow ice navigate navigation north
        compass stars sun direction map signal signalling mirror whistle rescue flood flooding
        cyclone hurricane storm earthquake landslide tsunami wildfire lightning thunder heatwave
        power outage blackout evacuate evacuation food forage edible plant plants mushroom berries
        animal bear leopard elephant monkey wild knot rope rain weather cold night survive
        survival stranded disaster emergency kit supplies ration knot knots bowline hitch tie
        rope cord go-bag bag evacuation fridge freezer outage cut
        """.split()
    ),
    "vehicle": set(
        """
        car vehicle bike motorbike motorcycle scooter truck bus auto engine motor tyre tire
        puncture flat battery jump start starter crank cranking clicking brake brakes clutch gear
        gearbox transmission fuel petrol diesel gas tank oil coolant radiator overheating
        overheat temperature gauge dashboard warning light lights headlight headlights fuse fuses
        belt hose leak leaking smoke exhaust steering wheel alignment vibration noise squeal
        grinding obd code check mil ev hybrid charging charge towing tow stuck mud sand chain
        spark plug kick carburettor carburetor ignition key alternator wiper horn airbag seatbelt
        accident crash highway road drive driving driver jack spare lug nut nuts bolt
        """.split()
    ),
}

_PHRASES = {
    "vehicle": ["check engine", "won't start", "wont start", "warning light", "jump start"],
    "medical": ["not breathing", "heart attack", "passed out", "can't breathe"],
    "survival": ["lost in", "no signal", "power cut"],
}

OUT_OF_SCOPE = re.compile(
    r"\b(python|javascript|java|code|coding|program|programming|sql|html|css|election|politic\w*|"
    r"president|prime minister|party|vote|stock|stocks|crypto|bitcoin|invest\w*|movie|film|song|"
    r"lyrics|poem|essay|homework|joke|celebrity|football|cricket score|recipe|dating|horoscope|"
    r"translate|capital of|who is|who won|cook\w*|bake|baking|cake|pasta|laptop|wifi|quantum)\b"
)

_STEMMED = {d: {stem(w) for w in ws} for d, ws in LEXICON.items()}


@dataclass
class Route:
    domain: str  # medical | survival | vehicle | other
    scores: dict[str, float]
    reason: str
    out_of_scope: bool = False  # clearly off-topic: decline rather than "not in library"


def route(query: str, retrieval_domain: str | None = None, retrieval_confidence: float = 0.0) -> Route:
    q = normalize(query)
    toks = [stem(w) for w in words(q)]
    scores = {d: float(sum(1 for t in toks if t in _STEMMED[d])) for d in LEXICON}
    for d, phrases in _PHRASES.items():
        scores[d] += sum(2.0 for p in phrases if p in q)
    if retrieval_domain and retrieval_confidence >= 0.4:
        scores[retrieval_domain] = scores.get(retrieval_domain, 0.0) + 1.5

    best = max(scores, key=lambda d: (scores[d], d == retrieval_domain))
    if OUT_OF_SCOPE.search(q) and scores[best] < 2:
        return Route("other", scores, "matched out-of-scope pattern", out_of_scope=True)
    if scores[best] == 0:
        return Route("other", scores, "no domain vocabulary and no confident library match")
    return Route(best, scores, "lexicon" + (" + retrieval" if retrieval_domain else ""))
