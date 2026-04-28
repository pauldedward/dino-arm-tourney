-- Rebrand affiliation copy on existing event rows from IAFF
-- (Indian Armwrestling Federation) to PAFI (People's Arm Wrestling
-- Federation India). TNAWA is now affiliated to PAFI.

update events
set id_card_footer = replace(id_card_footer, 'IAFF', 'PAFI')
where id_card_footer like '%IAFF%';

update events
set description = replace(description, 'IAFF', 'PAFI')
where description like '%IAFF%';

update events
set id_card_subtitle = replace(id_card_subtitle, 'IAFF', 'PAFI')
where id_card_subtitle like '%IAFF%';

-- Rename the Indian rule profile from IAFF-2024 to PAFI-2024 (and update
-- its display name) so the code identifier matches the new affiliation.
update rule_profiles
set
  code = 'PAFI-2024',
  name = 'People''s Arm Wrestling Federation India 2024'
where code = 'IAFF-2024';
