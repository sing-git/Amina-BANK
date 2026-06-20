from dataclasses import dataclass, field

#defines two shapes of data that get past between the other files. --> just structure
#this is just how python is going to organize the data from sanctionlists
#reads the sanctionlist and creates a sanction record for every name that appears on the list.

@dataclass(frozen=True) #is created for everyname that appears on sanction list
class SanctionRecord:
    """One screenable name on a sanctions list (a primary name or an alias)."""

    source: str          # e.g. "OFAC"
    list_name: str        # e.g. "SDN List"
    entity_id: str         # source-specific entity identifier
    entity_type: str        # "Entity", "Individual", "Vessel", "Aircraft", ...
    name: str                # the name as published
    is_primary: bool          # primary name vs. alias (A.K.A. / F.K.A. / N.K.A.)
    programs: tuple[str, ...] = field(default_factory=tuple)



@dataclass(frozen=True) #is created for every name that looks very simial to the company
class Match:
    record: SanctionRecord
    score: float   # 0-100 fuzzy similarity score
    query_normalized: str
    name_normalized: str
