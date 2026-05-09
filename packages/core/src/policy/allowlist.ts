export class Allowlist {
  private readonly users: Set<string>;

  constructor(allowedUserIds: string[]) {
    this.users = new Set(allowedUserIds);
  }

  has(userId: string): boolean {
    return this.users.has(userId);
  }

  list(): string[] {
    return [...this.users];
  }
}
