/**
 * Audit compte et profil n°5 : 4 caractères suffisaient. Même valeur que le
 * réglage Supabase (Authentication → Providers → Email → Minimum password length).
 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MIN_PLACEHOLDER = `${PASSWORD_MIN_LENGTH} caractères min.`;

export const PASSWORD_TOO_SHORT_MESSAGE = `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`;
