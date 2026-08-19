import {
  createProfile,
  DEFAULT_PROFILE_RULES,
  deserializeProfile,
  type ExperienceResult,
  grantExperience,
  type ProfileRules,
  type ProfileState,
  consumeStamina,
  recoverStamina,
  serializeProfile,
  type StaminaRecoveryResult,
  validateProfile,
} from './ProfileModel.ts';

export type ProfilePersistence = (serialized: string) => void;

export class ProfileService {
  private current: ProfileState;
  private readonly rules: ProfileRules;
  private readonly persist: ProfilePersistence;

  constructor(
    initialState: ProfileState = createProfile(),
    rules: ProfileRules = DEFAULT_PROFILE_RULES,
    persist: ProfilePersistence = () => {},
  ) {
    this.rules = rules;
    this.persist = persist;
    this.current = validateProfile(initialState, this.rules);
  }

  static fromSave(
    serialized: string,
    rules: ProfileRules = DEFAULT_PROFILE_RULES,
    persist: ProfilePersistence = () => {},
  ): ProfileService {
    return new ProfileService(deserializeProfile(serialized, rules), rules, persist);
  }

  snapshot(): ProfileState {
    return { ...this.current };
  }

  grantExperience(amount: number): ExperienceResult {
    const result = grantExperience(this.current, amount, this.rules);
    this.commit(result.state);
    return { ...result, state: this.snapshot() };
  }

  consumeStamina(amount: number): ProfileState {
    const next = consumeStamina(this.current, amount, this.rules);
    this.commit(next);
    return this.snapshot();
  }

  recoverStamina(now: number): StaminaRecoveryResult {
    const result = recoverStamina(this.current, now, this.rules);
    this.commit(result.state);
    return { ...result, state: this.snapshot() };
  }

  save(): string {
    const serialized = serializeProfile(this.current, this.rules);
    this.persist(serialized);
    return serialized;
  }

  private commit(next: ProfileState): void {
    const serialized = serializeProfile(next, this.rules);
    this.persist(serialized);
    this.current = next;
  }
}
