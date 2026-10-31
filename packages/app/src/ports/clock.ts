// The only source of the current time for app and domain code. The system adapter lives in apps/server; tests use a fake clock.
export interface Clock {
  now(): Date;
}
