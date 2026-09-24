export class UserMeResponseDto {
  id: string;
  name: string | null;
  email: string;
  status: string;
  role: {
    id: string;
    name: string;
  } | null;
  permissions: string[];
}
