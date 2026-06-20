from scrapers.sanctions.sources import ofac, un, opensanctions
from scrapers.sanctions.sources.opensanctions import _split


SDN_XML = """<?xml version="1.0"?>
<sdnList xmlns="http://tempuri.org/sdnList.xsd">
  <sdnEntry>
    <uid>306</uid>
    <lastName>BANCO NACIONAL DE CUBA</lastName>
    <sdnType>Entity</sdnType>
    <programList><program>CUBA</program></programList>
    <akaList>
      <aka><lastName>NATIONAL BANK OF CUBA</lastName></aka>
    </akaList>
  </sdnEntry>
  <sdnEntry>
    <uid>500</uid>
    <lastName>IVAN PETROV</lastName>
    <sdnType>Individual</sdnType>
    <programList><program>UKRAINE</program></programList>
  </sdnEntry>
</sdnList>"""

UN_XML = """<?xml version="1.0"?>
<CONSOLIDATED_LIST>
  <ENTITIES>
    <ENTITY>
      <REFERENCE_NUMBER>QE.1</REFERENCE_NUMBER>
      <FIRST_NAME>NORTH STAR TRADING</FIRST_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
      <ENTITY_ALIAS><ALIAS_NAME>NORTHSTAR FZE</ALIAS_NAME></ENTITY_ALIAS>
    </ENTITY>
  </ENTITIES>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <REFERENCE_NUMBER>QI.1</REFERENCE_NUMBER>
      <FIRST_NAME>IVAN</FIRST_NAME>
      <SECOND_NAME>PETROV</SECOND_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
    </INDIVIDUAL>
  </INDIVIDUALS>
</CONSOLIDATED_LIST>"""

OPENSANCTIONS_CSV = (
    "id,schema,name,aliases,dataset\n"
    "os-1,Organization,Banco Nacional de Cuba,National Bank of Cuba,US OFAC SDN\n"
    "os-2,CryptoWallet,1A2b3C...,,\n"
)


def test_ofac_parse_yields_primary_and_alias_records(tmp_path):
    xml_path = tmp_path / "sdn.xml"
    xml_path.write_text(SDN_XML, encoding="utf-8")

    records = list(ofac.parse(str(xml_path)))

    # 2 entries: one has 1 primary + 1 alias = 2 records, the other has 1 primary = 1 record
    assert len(records) == 3
    primary_names = {r.name for r in records if r.is_primary}
    assert primary_names == {"BANCO NACIONAL DE CUBA", "IVAN PETROV"}
    alias_names = {r.name for r in records if not r.is_primary}
    assert alias_names == {"NATIONAL BANK OF CUBA"}


def test_ofac_parse_filters_by_entity_type(tmp_path):
    xml_path = tmp_path / "sdn.xml"
    xml_path.write_text(SDN_XML, encoding="utf-8")

    records = list(ofac.parse(str(xml_path), entity_types={"Individual"}))

    assert len(records) == 1
    assert records[0].name == "IVAN PETROV"
    assert records[0].entity_type == "Individual"


def test_un_parse_joins_name_parts_and_includes_aliases(tmp_path):
    xml_path = tmp_path / "un.xml"
    xml_path.write_text(UN_XML, encoding="utf-8")

    records = list(un.parse(str(xml_path)))

    entity_records = [r for r in records if r.entity_type == "Entity"]
    individual_records = [r for r in records if r.entity_type == "Individual"]
    assert any(r.name == "NORTH STAR TRADING" and r.is_primary for r in entity_records)
    assert any(r.name == "NORTHSTAR FZE" and not r.is_primary for r in entity_records)
    assert any(r.name == "IVAN PETROV" and r.is_primary for r in individual_records)


def test_opensanctions_parse_maps_schema_and_skips_unmapped_rows(tmp_path):
    csv_path = tmp_path / "targets.simple.csv"
    csv_path.write_text(OPENSANCTIONS_CSV, encoding="utf-8")

    records = list(opensanctions.parse(str(csv_path)))

    # The "CryptoWallet" row has no Entity/Individual/etc. mapping and must be skipped.
    names = {r.name for r in records}
    assert "Banco Nacional de Cuba" in names
    assert "National Bank of Cuba" in names  # the alias
    assert not any("1A2b3C" in n for n in names)


def test_split_handles_empty_and_semicolon_separated_values():
    assert _split(None) == []
    assert _split("") == []
    assert _split("A; B ;C") == ["A", "B", "C"]
