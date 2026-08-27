export class UserMeResponseDto {
  id: string;
  name: string;
  email: string;
  status: string;
  role: {
    id: string;
    name: string;
  };
  permissions: string[];
}
