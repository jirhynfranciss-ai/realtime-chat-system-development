export type Role = "admin" | "user";

export type Profile = {
  id: string;
  user_id: string;
  email: string | null;
  role: Role;
  full_name: string | null;
  nickname: string | null;
  interests: string | null;
  hobbies: string | null;
  bio: string | null;
  favorite_color: string | null;
  favorite_food: string | null;
  avatar_url?: string | null;
  blocked?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  timestamp: string;
  seen_status: boolean;
  edited_at?: string | null;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
};

export type OnlinePresence = {
  user_id: string;
  name: string;
  role: Role;
};

export type ReminderItem = {
  id: string;
  text: string;
  dueAt: string;
  done: boolean;
};

export type UserSort = "active" | "newest" | "name";

export type ManagedProfileDraft = {
  full_name: string;
  nickname: string;
  interests: string;
  hobbies: string;
  favorite_color: string;
  favorite_food: string;
  bio: string;
};