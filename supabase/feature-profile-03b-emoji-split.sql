-- FEATURE-PROFILE-03b — emojis déplacés de gratuit vers Signature
--
-- À coller dans SQL Editor (prod) si FEATURE-PROFILE-03 est déjà appliqué.
-- Idempotent (`create or replace`). Un seul collage suffit (lots 1 + 2).
-- Déjà équipé sans pack : l’emoji est gardé tant qu’il n’est pas changé.

create or replace function public.profiles_signature_cosmetics()
returns trigger
language plpgsql
as $$
declare
  v_allowed_colors text[] := array['gold','rose','violet','cyan','lime','amber','coral','ice'];
  v_free_emoji text[] := array[
    '😀','🤩','🥳','🎭','🎮','🃏',
    '👤','🍺','⚽','⭐','🎲','🦊',
    '🐱','🐶','🦁','🍕','🎸','🕵️'
  ];
  v_sig_emoji text[] := array[
    '👑','🦄','🐉','🦋','🌙','⚡',
    '🥂','🏆','💫','🧿','🖤','🩷',
    '😈','👻','🔥','🐸','💎','🌈',
    '😎','💜','🌟','🎯','🚀','🎈'
  ];
  v_emoji text;
  v_old_emoji text;
begin
  if not coalesce(new.profile_pack, false) then
    new.name_color := null;
  elsif new.name_color is not null and not (new.name_color = any (v_allowed_colors)) then
    new.name_color := null;
  end if;

  v_emoji := nullif(trim(coalesce(new.emoji, '')), '');
  v_old_emoji := case when tg_op = 'UPDATE' then nullif(trim(coalesce(old.emoji, '')), '') else null end;

  if v_emoji is null then
    new.emoji := '👤';
  elsif v_emoji = any (v_free_emoji) then
    new.emoji := v_emoji;
  elsif coalesce(new.profile_pack, false) and v_emoji = any (v_sig_emoji) then
    new.emoji := v_emoji;
  elsif v_old_emoji is not null and v_emoji = v_old_emoji and v_emoji = any (v_sig_emoji) then
    new.emoji := v_old_emoji;
  else
    if v_old_emoji is not null and (
      v_old_emoji = any (v_free_emoji)
      or (coalesce(new.profile_pack, false) and v_old_emoji = any (v_sig_emoji))
    ) then
      new.emoji := v_old_emoji;
    else
      new.emoji := '👤';
    end if;
  end if;

  return new;
end;
$$;
