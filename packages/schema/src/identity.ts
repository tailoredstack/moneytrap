// Read-side shapes for identity queries (WP-2.12). Queries return these DTOs, never table rows,
// so no column that is not meant for the API (password hashes, token hashes) can leak out.
export interface UserProfileDto {
  id: string;
  email: string;
  status: "pending" | "active" | "suspended" | "closed";
  authVersion: number;
  locale: string;
  createdAt: string;
  updatedAt: string;
}
