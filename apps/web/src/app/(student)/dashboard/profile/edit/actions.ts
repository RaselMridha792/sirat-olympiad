'use server';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { PROFILE_UPDATE_FIELDS } from '@sirat/shared';
import type { ProfileFormState, ProfileFormValues } from '@/components/profile/ProfileForm';
import { getData } from '@/data';
import { parseProfileForm } from '@/data/profile';

/** Upper bound for echoed text, so a huge post is not sent straight back. */
const ECHO_MAX = 200;

/** The allow-listed fields exactly as posted (strings only), to refill the form after a failure. */
function echo(input: Record<string, unknown>): ProfileFormValues {
  const values = {} as ProfileFormValues;
  for (const field of PROFILE_UPDATE_FIELDS) {
    const raw = input[field];
    values[field] = typeof raw === 'string' ? raw.slice(0, ECHO_MAX) : '';
  }
  return values;
}

/**
 * PATCH /users/me through the data source. No user id is read from the form: the API takes the
 * acting user from the session cookie. parseProfileForm reads only the allow-list, so anything
 * else that is posted (role, email, category, points...) is dropped before it leaves the server.
 */
export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const input = Object.fromEntries(formData);
  const values = echo(input);
  try {
    const data = await getData();
    const options = await data.student.getProfileOptions();
    const { value, result } = parseProfileForm(input, options);
    if (!result.ok) return { values, fieldErrors: result.fieldErrors };
    const saved = await data.student.updateProfile(value);
    if (!saved.ok) return { values, fieldErrors: saved.fieldErrors };
  } catch (error) {
    // Let Next.js control flow through (e.g. a future data source redirecting to /login).
    unstable_rethrow(error);
    return { values, formError: true }; // never the raw message
  }
  // Outside the try: redirect() throws by design and must not be caught above.
  // Name and category also show in the dashboard layout and on other dashboard pages. The path is
  // the route file path, so it names the (student) group: '/dashboard' would match no layout.
  revalidatePath('/(student)/dashboard', 'layout');
  redirect('/dashboard/profile?saved=1');
}
