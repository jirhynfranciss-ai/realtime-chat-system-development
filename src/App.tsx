import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient, type RealtimeChannel, type Session } from "@supabase/supabase-js";

type Role = "admin" | "user";

type Profile = {
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
  blocked?: boolean;
  created_at?: string;
};

type Message = {
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

type OnlinePresence = {
  user_id: string;
  name: string;
  role: Role;
};

type ReminderItem = {
  id: string;
  text: string;
  dueAt: string;
  done: boolean;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(supabaseUrl && supabaseAnonKey);
const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.toLowerCase().trim();

const supabase = configured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

const emojiReactions = ["❤️", "😊", "🔥", "👍", "😂"];
const quickIcebreakers = [
  "How was your day so far?",
  "What made you smile today?",
  "What is your current favorite song?",
  "If we plan a chill day, what should we do first?",
];

const quickReplies = ["Noted", "Tell me more", "I like that", "Give me 5 mins", "Sounds good"];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function JumpingDots() {
  return (
    <div className="inline-flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-300"
          style={{ animation: "dot-jump 0.9s infinite", animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function isSingleRowCoerceError(message: string) {
  const text = message.toLowerCase();
  return text.includes("cannot coerce the result to a single json object") || text.includes("json object requested");
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const savedTheme = window.localStorage.getItem("crushconnect-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [typingStatus, setTypingStatus] = useState<Record<string, string>>({});
  const [onlineUsers, setOnlineUsers] = useState<Record<string, OnlinePresence>>({});
  const [unreadByUser, setUnreadByUser] = useState<Record<string, number>>({});
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMediaUploading, setIsMediaUploading] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginRole, setLoginRole] = useState<Role>("user");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [interests, setInterests] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [favoriteFood, setFavoriteFood] = useState("");
  const [favoriteColor, setFavoriteColor] = useState("");
  const [bio, setBio] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "online" | "unread">("all");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<Record<string, boolean>>({});
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [muteNotifications, setMuteNotifications] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderInput, setReminderInput] = useState("");
  const [reminderDateTime, setReminderDateTime] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>("");
  const [mobilePane, setMobilePane] = useState<"panel" | "chat">("chat");

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);

  const isAdmin = profile?.role === "admin";
  const currentUserId = session?.user.id ?? "";
  const activeAdminProfile = profiles.find((entry) => entry.role === "admin");
  const activeRecipientId = isAdmin ? selectedUserId : activeAdminProfile?.user_id ?? "";

  const totalUnread = useMemo(() => {
    return Object.values(unreadByUser).reduce((sum, count) => sum + count, 0);
  }, [unreadByUser]);

  const visibleUsers = useMemo(() => {
    const base = profiles.filter((entry) => entry.role === "user");
    return base
      .filter((entry) => {
        if (userFilter === "online") {
          return Boolean(onlineUsers[entry.user_id]);
        }
        if (userFilter === "unread") {
          return (unreadByUser[entry.user_id] ?? 0) > 0;
        }
        return true;
      })
      .filter((entry) => {
        const target = `${entry.nickname ?? ""} ${entry.full_name ?? ""} ${entry.email ?? ""}`.toLowerCase();
        return target.includes(userSearch.trim().toLowerCase());
      });
  }, [profiles, userFilter, unreadByUser, userSearch, onlineUsers]);

  const messageStats = useMemo(() => {
    const words = messages.reduce((sum, entry) => sum + entry.message.trim().split(/\s+/).filter(Boolean).length, 0);
    const mine = messages.filter((entry) => entry.sender_id === currentUserId).length;
    const today = new Date().toDateString();
    const todayCount = messages.filter((entry) => new Date(entry.timestamp).toDateString() === today).length;
    return {
      total: messages.length,
      mine,
      avgWords: messages.length ? Math.round(words / messages.length) : 0,
      todayCount,
    };
  }, [messages, currentUserId]);

  const filteredMessages = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return messages.filter((entry) => {
      const matchesText = query ? entry.message.toLowerCase().includes(query) : true;
      const matchesFavorite = showFavoritesOnly ? Boolean(favoriteIds[entry.id]) : true;
      return matchesText && matchesFavorite;
    });
  }, [messages, searchTerm, showFavoritesOnly, favoriteIds]);

  const mediaMessages = useMemo(() => {
    return messages.filter((entry) => Boolean(entry.media_url)).slice(-10).reverse();
  }, [messages]);

  useEffect(() => {
    // Keep auth screen consistently dark while preserving user theme preference after login.
    const authScreen = !session || !profile;
    const effectiveTheme = authScreen ? "dark" : theme;
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
    document.documentElement.style.colorScheme = effectiveTheme;
    window.localStorage.setItem("crushconnect-theme", theme);
  }, [theme, session, profile]);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setProfiles([]);
        setMessages([]);
        setSelectedUserId("");
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationEnabled(Notification.permission === "granted");
    }
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      return;
    }

    const ensureProfile = async () => {
      // Avoid single-row coercion errors by reading as a list and taking the first row.
      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .limit(1);

      if (fetchError) {
        setAuthError(fetchError.message);
        return;
      }

      const existing = ((data ?? []) as Profile[])[0];
      if (existing) {
        setProfile(existing);
        setFullName(existing.full_name ?? "");
        setNickname(existing.nickname ?? "");
        setInterests(existing.interests ?? "");
        setHobbies(existing.hobbies ?? "");
        setFavoriteFood(existing.favorite_food ?? "");
        setFavoriteColor(existing.favorite_color ?? "");
        setBio(existing.bio ?? "");
        return;
      }

      setAuthError("Profile is still being prepared. Please wait a moment then log in again.");
    };

    void ensureProfile();
  }, [session]);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      return;
    }

    const channel = supabase.channel("presence:online");
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<OnlinePresence>();
        const flattened: Record<string, OnlinePresence> = {};
        Object.values(state).forEach((entryList) => {
          entryList.forEach((entry) => {
            flattened[entry.user_id] = entry;
          });
        });
        setOnlineUsers(flattened);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: session.user.id,
            name: profile?.nickname || profile?.full_name || session.user.email || "User",
            role: profile?.role ?? "user",
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, profile?.nickname, profile?.full_name, profile?.role]);

  useEffect(() => {
    if (!supabase || !profile) {
      return;
    }

    const fetchProfiles = async () => {
      const query = supabase.from("profiles").select("*");
      const { data, error } = isAdmin
        ? await query.order("created_at", { ascending: true })
        : await query.eq("role", "admin").limit(1);

      if (error) {
        setAuthError(error.message);
        return;
      }

      const safeProfiles = (data ?? []) as Profile[];
      setProfiles(safeProfiles);

      if (isAdmin && !selectedUserId) {
        const firstUser = safeProfiles.find((entry) => entry.role === "user" && !entry.blocked);
        if (firstUser) {
          setSelectedUserId(firstUser.user_id);
        }
      }
    };

    void fetchProfiles();
  }, [profile, isAdmin, selectedUserId]);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      return;
    }

    const channel = supabase
      .channel(`realtime:messages:${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const newMessage = payload.new as Message;
        const involvesMe = newMessage.sender_id === session.user.id || newMessage.receiver_id === session.user.id;
        if (!involvesMe) {
          return;
        }

        const otherId = newMessage.sender_id === session.user.id ? newMessage.receiver_id : newMessage.sender_id;
        if (otherId === activeRecipientId) {
          setMessages((prev) => (prev.some((entry) => entry.id === newMessage.id) ? prev : [...prev, newMessage]));
        } else if (newMessage.receiver_id === session.user.id) {
          setUnreadByUser((prev) => ({ ...prev, [newMessage.sender_id]: (prev[newMessage.sender_id] ?? 0) + 1 }));
        }

        setActivityLogs((prev) => [
          `New message ${newMessage.receiver_id === session.user.id ? "received" : "sent"} at ${formatDateTime(newMessage.timestamp)}`,
          ...prev,
        ].slice(0, 8));

        if (
          notificationEnabled &&
          !muteNotifications &&
          newMessage.receiver_id === session.user.id &&
          document.visibilityState !== "visible" &&
          "Notification" in window
        ) {
          if (Notification.permission === "granted") {
            new Notification("New message", { body: newMessage.message });
          } else if (Notification.permission === "default") {
            void Notification.requestPermission();
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const updated = payload.new as Message;
        setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, activeRecipientId, notificationEnabled, muteNotifications]);

  useEffect(() => {
    if (!supabase || !session?.user.id || !activeRecipientId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      setIsMessagesLoading(true);
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${session.user.id},receiver_id.eq.${activeRecipientId}),and(sender_id.eq.${activeRecipientId},receiver_id.eq.${session.user.id})`,
        )
        .order("timestamp", { ascending: true });

      if (error) {
        setAuthError(error.message);
        setIsMessagesLoading(false);
        return;
      }

      setMessages((data ?? []) as Message[]);
      setUnreadByUser((prev) => ({ ...prev, [activeRecipientId]: 0 }));

      await supabase
        .from("messages")
        .update({ seen_status: true })
        .eq("receiver_id", session.user.id)
        .eq("sender_id", activeRecipientId)
        .eq("seen_status", false);
      setIsMessagesLoading(false);
    };

    void loadMessages();
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!supabase || !session?.user.id || !activeRecipientId) {
      if (typingChannelRef.current && supabase) {
        void supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      return;
    }

    const channel = supabase.channel(`typing:${[session.user.id, activeRecipientId].sort().join(":")}`);
    typingChannelRef.current = channel;

    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        const data = payload.payload as { from: string; to: string; name: string; active: boolean };
        if (data.to !== session.user.id) {
          return;
        }
        setTypingStatus((prev) => {
          if (!data.active) {
            const { [data.from]: _removed, ...rest } = prev;
            return rest;
          }
          return { ...prev, [data.from]: data.name };
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (autoScroll) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  useEffect(() => {
    return () => {
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview);
      }
    };
  }, [mediaPreview]);

  useEffect(() => {
    if (!session?.user.id || !activeRecipientId) {
      return;
    }
    const key = `crushconnect-draft:${session.user.id}:${activeRecipientId}`;
    const saved = window.localStorage.getItem(key);
    setDraft(saved ?? "");
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!session?.user.id || !activeRecipientId) {
      return;
    }
    const key = `crushconnect-draft:${session.user.id}:${activeRecipientId}`;
    if (draft.trim()) {
      window.localStorage.setItem(key, draft);
    } else {
      window.localStorage.removeItem(key);
    }
  }, [draft, session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!session?.user.id || !activeRecipientId) {
      setFavoriteIds({});
      return;
    }
    const key = `crushconnect-favorites:${session.user.id}:${activeRecipientId}`;
    const saved = window.localStorage.getItem(key);
    setFavoriteIds(saved ? (JSON.parse(saved) as Record<string, boolean>) : {});
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!session?.user.id || !activeRecipientId) {
      return;
    }
    const key = `crushconnect-favorites:${session.user.id}:${activeRecipientId}`;
    window.localStorage.setItem(key, JSON.stringify(favoriteIds));
  }, [favoriteIds, session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!session?.user.id) {
      setReminders([]);
      return;
    }
    const key = `crushconnect-reminders:${session.user.id}`;
    const saved = window.localStorage.getItem(key);
    setReminders(saved ? (JSON.parse(saved) as ReminderItem[]) : []);
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) {
      return;
    }
    const key = `crushconnect-reminders:${session.user.id}`;
    window.localStorage.setItem(key, JSON.stringify(reminders));
  }, [reminders, session?.user.id]);

  useEffect(() => {
    if (isAdmin) {
      setMobilePane(selectedUserId ? "chat" : "panel");
    } else {
      setMobilePane("chat");
    }
  }, [isAdmin, selectedUserId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminders((prev) => {
        const now = Date.now();
        return prev.map((entry) => {
          if (!entry.done && new Date(entry.dueAt).getTime() <= now) {
            return { ...entry, done: true };
          }
          return entry;
        });
      });
    }, 30000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      return;
    }
    const normalizedEmail = authEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setAuthError("Email is required.");
      return;
    }

    setAuthError("");
    setAuthInfo("");
    setIsSubmitting(true);

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: authPassword,
        options: {
          data: {
            full_name: fullName,
            nickname,
            interests,
            hobbies,
          },
        },
      });

      if (error) {
        setAuthError(error.message);
      } else if (data.user) {
        setAuthInfo("Account created. If email confirmation is enabled, verify your email, then log in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: authPassword,
      });

      if (error) {
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          setAuthError("Invalid login credentials. Check email/password, and verify your email if confirmation is enabled.");
        } else {
          setAuthError(error.message);
        }
      } else if (loginRole === "admin" && adminEmail && normalizedEmail !== adminEmail) {
        setAuthError("This account is not allowed to sign in as admin.");
        await supabase.auth.signOut();
      }
    }

    setIsSubmitting(false);
  };

  const sendTypingSignal = (active: boolean) => {
    if (!typingChannelRef.current || !session?.user.id || !activeRecipientId) {
      return;
    }

    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: {
        from: session.user.id,
        to: activeRecipientId,
        name: profile?.nickname || profile?.full_name || "Someone",
        active,
      },
    });
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    sendTypingSignal(value.trim().length > 0);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      sendTypingSignal(false);
    }, 1200);
  };

  const handlePickMedia = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    const isAllowed = file.type.startsWith("image/") || file.type.startsWith("video/");
    if (!isAllowed) {
      setAuthError("Only image or video files are supported.");
      return;
    }
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
    setAuthError("");
    event.target.value = "";
  };

  const clearMediaDraft = () => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview("");
    setMediaFile(null);
  };

  const handleSendMessage = async () => {
    if (!supabase || !session?.user.id || !activeRecipientId || (!draft.trim() && !mediaFile)) {
      return;
    }

    let mediaUrl: string | null = null;
    let mediaType: "image" | "video" | null = null;

    if (mediaFile) {
      setIsMediaUploading(true);
      const extension = mediaFile.name.split(".").pop() ?? "bin";
      const path = `${session.user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("chat-media").upload(path, mediaFile, { upsert: false });
      if (uploadError) {
        setAuthError(uploadError.message);
        setIsMediaUploading(false);
        return;
      }
      const { data: publicData } = supabase.storage.from("chat-media").getPublicUrl(path);
      mediaUrl = publicData.publicUrl;
      mediaType = mediaFile.type.startsWith("video/") ? "video" : "image";
      setIsMediaUploading(false);
    }

    const baseText = draft.trim() || (mediaUrl ? "Sent an attachment" : "");
    const composedMessage = replyTo ? `Reply to: ${replyTo.message}\n${baseText}` : baseText;

    const payload = {
      sender_id: session.user.id,
      receiver_id: activeRecipientId,
      message: composedMessage,
      timestamp: new Date().toISOString(),
      seen_status: false,
      media_url: mediaUrl,
      media_type: mediaType,
    };

    setDraft("");
    sendTypingSignal(false);
    setIsSending(true);

    const { data, error } = await supabase.from("messages").insert(payload).select("*");
    if (error) {
      if (!isSingleRowCoerceError(error.message)) {
        setAuthError(error.message);
      }
      setIsSending(false);
      return;
    }

    const inserted = ((data ?? []) as Message[])[0];
    if (inserted) {
      setMessages((prev) => (prev.some((entry) => entry.id === inserted.id) ? prev : [...prev, inserted]));
    }
    clearMediaDraft();
    setReplyTo(null);
    setIsSending(false);
  };

  const handleProfileSave = async () => {
    if (!supabase || !profile) {
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        nickname,
        interests,
        hobbies,
        favorite_food: favoriteFood,
        favorite_color: favoriteColor,
        bio,
      })
      .eq("user_id", profile.user_id);

    if (error) {
      setProfileStatus(error.message);
      return;
    }

    const updatedProfile: Profile = {
      ...profile,
      full_name: fullName,
      nickname,
      interests,
      hobbies,
      favorite_food: favoriteFood,
      favorite_color: favoriteColor,
      bio,
    };
    setProfile(updatedProfile);
    setProfiles((prev) => prev.map((entry) => (entry.user_id === updatedProfile.user_id ? { ...entry, ...updatedProfile } : entry)));
    setProfileStatus("Profile updated.");
  };

  const handleToggleBlocked = async (userId: string, blocked: boolean) => {
    if (!supabase) {
      return;
    }

    const { error } = await supabase.from("profiles").update({ blocked: !blocked }).eq("user_id", userId);
    if (error) {
      setAuthError("Unable to update block status. Add a boolean `blocked` column to profiles.");
      return;
    }

    setProfiles((prev) => prev.map((entry) => (entry.user_id === userId ? { ...entry, blocked: !blocked } : entry)));
  };

  const handleDeleteUser = async (userId: string) => {
    if (!supabase) {
      return;
    }

    const confirmDelete = window.confirm("Delete this user profile and related messages?");
    if (!confirmDelete) {
      return;
    }

    await supabase.from("messages").delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    const { error } = await supabase.from("profiles").delete().eq("user_id", userId);
    if (error) {
      setAuthError(error.message);
      return;
    }

    setProfiles((prev) => prev.filter((entry) => entry.user_id !== userId));
    if (selectedUserId === userId) {
      setSelectedUserId("");
      setMessages([]);
    }
  };

  const handleDeleteMessage = async (messageId: string, canDelete: boolean) => {
    if (!supabase || !canDelete) {
      return;
    }

    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setMessages((prev) => prev.filter((entry) => entry.id !== messageId));
  };

  const handleStartEditMessage = (entry: Message) => {
    setEditingMessageId(entry.id);
    setEditingMessageText(entry.message);
  };

  const handleSaveEditMessage = async (messageId: string) => {
    if (!supabase || !editingMessageText.trim()) {
      return;
    }

    const editedAt = new Date().toISOString();
    let { error } = await supabase
      .from("messages")
      .update({ message: editingMessageText.trim(), edited_at: editedAt })
      .eq("id", messageId);

    if (error && error.message.includes("edited_at")) {
      const fallback = await supabase
        .from("messages")
        .update({ message: editingMessageText.trim() })
        .eq("id", messageId);
      error = fallback.error;
      if (!fallback.error) {
        setProfileStatus("Message edited. Run latest SQL to enable edited labels.");
      }
    }

    if (error && isSingleRowCoerceError(error.message)) {
      error = null;
    }

    if (error) {
      setAuthError(error.message);
      return;
    }
    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === messageId
          ? {
              ...entry,
              message: editingMessageText.trim(),
              edited_at: entry.edited_at ?? editedAt,
            }
          : entry,
      ),
    );
    setEditingMessageId(null);
    setEditingMessageText("");
  };

  const toggleFavoriteMessage = (messageId: string) => {
    setFavoriteIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setProfileStatus("Message copied.");
    } catch {
      setProfileStatus("Copy failed on this device/browser.");
    }
  };

  const handleRequestNotifications = async () => {
    if (!("Notification" in window)) {
      setAuthError("Notifications are not supported on this browser.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationEnabled(permission === "granted");
    if (permission !== "granted") {
      setAuthError("Notification permission was not granted.");
    }
  };

  const handleResetPassword = async () => {
    if (!supabase || !authEmail.trim()) {
      setAuthError("Enter your email first to reset password.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    });
    if (error) {
      setAuthError(error.message);
      return;
    }
    setAuthInfo("Password reset link sent. Check your email inbox.");
  };

  const handleAddReminder = () => {
    if (!reminderInput.trim() || !reminderDateTime) {
      return;
    }
    setReminders((prev) => [
      {
        id: crypto.randomUUID(),
        text: reminderInput.trim(),
        dueAt: reminderDateTime,
        done: false,
      },
      ...prev,
    ]);
    setReminderInput("");
    setReminderDateTime("");
  };

  const handleRemoveReminder = (id: string) => {
    setReminders((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleSendWelcome = async () => {
    if (!supabase || !isAdmin || !session?.user.id || !selectedUserId) {
      return;
    }
    const { error } = await supabase.from("messages").insert({
      sender_id: session.user.id,
      receiver_id: selectedUserId,
      message: "Welcome to CrushConnect. I am happy to chat with you here.",
      timestamp: new Date().toISOString(),
      seen_status: false,
    });
    if (error) {
      setAuthError(error.message);
    }
  };

  const handleExportChat = () => {
    if (!messages.length || !activeRecipientId) {
      return;
    }
    const content = messages
      .map((entry) => {
        const author = entry.sender_id === currentUserId ? "Me" : "Them";
        const mediaPart = entry.media_url ? ` [${entry.media_type ?? "media"}: ${entry.media_url}]` : "";
        return `[${formatDateTime(entry.timestamp)}] ${author}: ${entry.message}${mediaPart}`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${activeRecipientId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBroadcast = async () => {
    if (!supabase || !session?.user.id || !isAdmin || !draft.trim()) {
      return;
    }

    const targets = profiles.filter((entry) => entry.role === "user" && !entry.blocked);
    const queue = targets.map((entry) => ({
      sender_id: session.user.id,
      receiver_id: entry.user_id,
      message: `[Broadcast] ${draft.trim()}`,
      timestamp: new Date().toISOString(),
      seen_status: false,
    }));

    const { error } = await supabase.from("messages").insert(queue);
    if (error) {
      setAuthError(error.message);
      return;
    }

    setDraft("");
    setActivityLogs((prev) => [`Broadcast sent to ${queue.length} users at ${formatDateTime(new Date().toISOString())}`, ...prev].slice(0, 8));
  };

  const handleLogout = async () => {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
  };

  if (!configured) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
        <div className="mx-auto max-w-3xl space-y-4">
          <h1 className="text-3xl font-semibold">CrushConnect Control Room</h1>
          <p className="text-slate-300">Add Supabase credentials to start this secure chat system.</p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
{`VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_ADMIN_EMAIL=your_admin_email`}
          </pre>
          <p className="text-sm text-slate-400">
            Create tables: <span className="font-medium">profiles</span> and <span className="font-medium">messages</span>, then enable RLS
            policies so users can only read their own conversations.
          </p>
          <p className="text-sm text-slate-400">
            Full setup guide: <span className="font-medium">SUPABASE_SETUP.md</span> and SQL: <span className="font-medium">supabase/schema.sql</span>
          </p>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">Loading secure channel...</div>;
  }

  if (!session || !profile) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100 transition-colors">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.2),transparent_40%),radial-gradient(circle_at_85%_10%,rgba(59,130,246,0.2),transparent_34%)]" />
        <motion.section
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16"
        >
          <div className="grid w-full gap-12 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div className="space-y-5">
              <p className="text-sm uppercase tracking-[0.18em] text-cyan-300">CrushConnect</p>
              <h1 className="text-4xl font-semibold leading-tight md:text-5xl">Private messaging designed for meaningful connection.</h1>
              <p className="max-w-xl text-slate-300">
                A secure, role-based chat system built with Supabase Auth, Realtime, and row-level access control for clean one-to-one conversations.
              </p>
            </div>

            <form
              onSubmit={handleAuthSubmit}
              className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur"
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm ${authMode === "login" ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-slate-100"}`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm ${authMode === "signup" ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-slate-100"}`}
                >
                  Sign Up
                </button>
              </div>

              {authMode === "login" && (
                <div className="flex gap-2 rounded-lg bg-white/5 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setLoginRole("user")}
                    className={`w-1/2 rounded-md py-1.5 ${loginRole === "user" ? "bg-white text-slate-900" : "text-slate-300"}`}
                  >
                    User
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginRole("admin")}
                    className={`w-1/2 rounded-md py-1.5 ${loginRole === "admin" ? "bg-white text-slate-900" : "text-slate-300"}`}
                  >
                    Admin
                  </button>
                </div>
              )}

              <input
                required
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                type="email"
                placeholder="Email"
              />
              <input
                required
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                type="password"
                placeholder="Password"
              />
              {authMode === "login" && (
                <button
                  type="button"
                  onClick={() => {
                    void handleResetPassword();
                  }}
                  className="text-xs text-cyan-200 underline underline-offset-2"
                >
                  Forgot password?
                </button>
              )}

              {authMode === "signup" && (
                <>
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    placeholder="Full name"
                  />
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    placeholder="Nickname"
                  />
                  <input
                    value={interests}
                    onChange={(event) => setInterests(event.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    placeholder="Interests"
                  />
                  <input
                    value={hobbies}
                    onChange={(event) => setHobbies(event.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    placeholder="Hobbies"
                  />
                </>
              )}

              {authError && <p className="text-sm text-rose-300">{authError}</p>}
              {authInfo && <p className="text-sm text-cyan-200">{authInfo}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-cyan-400 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Please wait..." : authMode === "signup" ? "Create Account" : "Secure Login"}
              </button>
            </form>
          </div>
        </motion.section>
      </main>
    );
  }

  const selectedUser = profiles.find((entry) => entry.user_id === selectedUserId);
  const typingNames = Object.values(typingStatus).join(", ");

  return (
    <main className="min-h-dvh overflow-x-hidden bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-500">CrushConnect</p>
            <h1 className="text-lg font-semibold">{isAdmin ? "Admin Console" : "Private Chat"}</h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <span className="rounded-full border border-cyan-400/40 px-3 py-1 capitalize">{profile.role}</span>
            <span className="hidden text-slate-500 md:inline">Unread: {totalUnread}</span>
            <span className="hidden text-slate-500 md:inline">Online: {Object.keys(onlineUsers).length}</span>
            <button
              type="button"
              onClick={() => setMobilePane((prev) => (prev === "chat" ? "panel" : "chat"))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:hidden"
            >
              {mobilePane === "chat" ? "Open Panel" : "Open Chat"}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRequestNotifications();
              }}
              className="hidden rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:inline"
            >
              {notificationEnabled ? "Notifications On" : "Enable Alerts"}
            </button>
            <button
              type="button"
              onClick={() => setMuteNotifications((prev) => !prev)}
              className="hidden rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:inline"
            >
              {muteNotifications ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700 md:px-3 md:py-1.5 md:text-sm"
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={() => setShowProfilePanel((prev) => !prev)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700 md:px-3 md:py-1.5 md:text-sm"
            >
              {showProfilePanel ? "Hide Profile" : "Show Profile"}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs text-white dark:bg-slate-100 dark:text-slate-900 md:px-3 md:py-1.5 md:text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-0 md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={`${mobilePane === "panel" ? "block" : "hidden"} border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block`}>
          {isAdmin ? (
            <div className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold">Users</h2>
                <p className="text-xs text-slate-500">Manage access and open private chats.</p>
              </div>

              <div className="space-y-2">
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Search users"
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-xs dark:border-slate-700"
                />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button type="button" onClick={() => setUserFilter("all")} className={`rounded-lg px-2 py-1 ${userFilter === "all" ? "bg-cyan-500 text-slate-950" : "border border-slate-300 dark:border-slate-700"}`}>
                    All
                  </button>
                  <button type="button" onClick={() => setUserFilter("online")} className={`rounded-lg px-2 py-1 ${userFilter === "online" ? "bg-cyan-500 text-slate-950" : "border border-slate-300 dark:border-slate-700"}`}>
                    Online
                  </button>
                  <button type="button" onClick={() => setUserFilter("unread")} className={`rounded-lg px-2 py-1 ${userFilter === "unread" ? "bg-cyan-500 text-slate-950" : "border border-slate-300 dark:border-slate-700"}`}>
                    Unread
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {visibleUsers.map((entry) => {
                    const isOnline = Boolean(onlineUsers[entry.user_id]);
                    const isSelected = selectedUserId === entry.user_id;
                    return (
                        <motion.button
                        whileHover={{ x: 3 }}
                        key={entry.user_id}
                        type="button"
                          onClick={() => {
                            setSelectedUserId(entry.user_id);
                            setMobilePane("chat");
                          }}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          isSelected
                            ? "border-cyan-300 bg-cyan-50 dark:border-cyan-500/50 dark:bg-cyan-500/10"
                            : "border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span>{entry.nickname || entry.full_name || "Unnamed"}</span>
                          <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-slate-400"}`} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{entry.email}</div>
                        {(unreadByUser[entry.user_id] ?? 0) > 0 && <div className="mt-1 text-xs text-cyan-600">{unreadByUser[entry.user_id]} unread</div>}
                      </motion.button>
                    );
                  })}
              </div>

              {selectedUser && (
                <div className="space-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleToggleBlocked(selectedUser.user_id, Boolean(selectedUser.blocked))}
                    className="w-full rounded-lg border border-amber-300 px-3 py-2 text-amber-700 dark:border-amber-500/40 dark:text-amber-300"
                  >
                    {selectedUser.blocked ? "Unblock User" : "Block User"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(selectedUser.user_id)}
                    className="w-full rounded-lg border border-rose-300 px-3 py-2 text-rose-700 dark:border-rose-500/40 dark:text-rose-300"
                  >
                    Delete User
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSendWelcome();
                    }}
                    className="w-full rounded-lg border border-cyan-300 px-3 py-2 text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300"
                  >
                    Send Welcome Message
                  </button>
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Activity Log</p>
                {activityLogs.length === 0 ? <p>No recent activity.</p> : activityLogs.map((entry) => <p key={entry}>{entry}</p>)}
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">Reminders</h3>
                <input
                  value={reminderInput}
                  onChange={(event) => setReminderInput(event.target.value)}
                  placeholder="Reminder text"
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                />
                <input
                  value={reminderDateTime}
                  onChange={(event) => setReminderDateTime(event.target.value)}
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                />
                <button type="button" onClick={handleAddReminder} className="w-full rounded-lg border border-cyan-300 px-3 py-2 text-sm text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300">
                  Add Reminder
                </button>
                <div className="max-h-36 space-y-2 overflow-y-auto text-xs">
                  {reminders.length === 0 && <p className="text-slate-500">No reminders yet.</p>}
                  {reminders.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">
                      <p className={entry.done ? "line-through opacity-60" : ""}>{entry.text}</p>
                      <p className="text-slate-500">{formatDateTime(entry.dueAt)}</p>
                      <button type="button" onClick={() => handleRemoveReminder(entry.id)} className="underline underline-offset-2">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {mediaMessages.length > 0 && (
                <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="text-sm font-semibold">Recent Media</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {mediaMessages.map((entry) => (
                      <a key={entry.id} href={entry.media_url ?? "#"} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                        {entry.media_type === "video" ? (
                          <video src={entry.media_url ?? undefined} className="h-16 w-full object-cover" muted />
                        ) : (
                          <img src={entry.media_url ?? undefined} alt="Shared media" className="h-16 w-full object-cover" loading="lazy" />
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {showProfilePanel && (
                <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">My Profile</h3>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="Interests" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <input value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder="Hobbies" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <input value={favoriteColor} onChange={(e) => setFavoriteColor(e.target.value)} placeholder="Favorite color" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <input value={favoriteFood} onChange={(e) => setFavoriteFood(e.target.value)} placeholder="Favorite food" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio" className="h-16 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <button type="button" onClick={handleProfileSave} className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">
                  Save Profile
                </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {showProfilePanel && (
                <>
                  <h2 className="text-sm font-semibold">Profile</h2>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="Interests" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <input value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder="Hobbies" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <input value={favoriteColor} onChange={(e) => setFavoriteColor(e.target.value)} placeholder="Favorite color" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <input value={favoriteFood} onChange={(e) => setFavoriteFood(e.target.value)} placeholder="Favorite food" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio" className="h-20 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                  <button type="button" onClick={handleProfileSave} className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">
                    Save Profile
                  </button>
                </>
              )}
              <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <h3 className="text-sm font-semibold">Personal Reminders</h3>
                <input
                  value={reminderInput}
                  onChange={(event) => setReminderInput(event.target.value)}
                  placeholder="Reminder text"
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                />
                <input
                  value={reminderDateTime}
                  onChange={(event) => setReminderDateTime(event.target.value)}
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                />
                <button type="button" onClick={handleAddReminder} className="w-full rounded-lg border border-cyan-300 px-3 py-2 text-sm text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300">
                  Add Reminder
                </button>
                <div className="max-h-36 space-y-2 overflow-y-auto text-xs">
                  {reminders.length === 0 && <p className="text-slate-500">No reminders yet.</p>}
                  {reminders.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">
                      <p className={entry.done ? "line-through opacity-60" : ""}>{entry.text}</p>
                      <p className="text-slate-500">{formatDateTime(entry.dueAt)}</p>
                      <button type="button" onClick={() => handleRemoveReminder(entry.id)} className="underline underline-offset-2">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {mediaMessages.length > 0 && (
                <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <h3 className="text-sm font-semibold">Recent Media</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {mediaMessages.map((entry) => (
                      <a key={entry.id} href={entry.media_url ?? "#"} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                        {entry.media_type === "video" ? (
                          <video src={entry.media_url ?? undefined} className="h-14 w-full object-cover" muted />
                        ) : (
                          <img src={entry.media_url ?? undefined} alt="Shared media" className="h-14 w-full object-cover" loading="lazy" />
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {profileStatus && <p className="text-xs text-slate-500">{profileStatus}</p>}
            </div>
          )}
        </aside>

        <section className={`${mobilePane === "chat" ? "flex" : "hidden"} h-[calc(100dvh-65px)] min-w-0 flex-col md:flex`}>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 md:px-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {isAdmin
                    ? selectedUser
                      ? `Chat with ${selectedUser.nickname || selectedUser.full_name || "User"}`
                      : "Select a user"
                    : `Chat with ${profiles.find((entry) => entry.role === "admin")?.nickname || "Admin"}`}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeRecipientId && onlineUsers[activeRecipientId]
                    ? "Online now"
                    : activeRecipientId
                      ? "Offline now. You can still send messages."
                      : "No recipient available yet."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setMobilePane("panel")}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:hidden"
              >
                Back
              </button>

              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  onClick={() => setShowFavoritesOnly((prev) => !prev)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
                >
                  {showFavoritesOnly ? "All Messages" : "Favorites"}
                </button>
                <button
                  type="button"
                  onClick={() => setAutoScroll((prev) => !prev)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
                >
                  Auto Scroll: {autoScroll ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={handleExportChat}
                  disabled={!messages.length}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
                >
                  Export Chat
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleBroadcast}
                    className="rounded-lg border border-cyan-300 px-3 py-1.5 text-sm text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300"
                  >
                    Broadcast Draft
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 md:hidden">
              <button
                type="button"
                onClick={() => setShowFavoritesOnly((prev) => !prev)}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
              >
                {showFavoritesOnly ? "All" : "Favorites"}
              </button>
              <button
                type="button"
                onClick={handleExportChat}
                disabled={!messages.length}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-700"
              >
                Export
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleBroadcast}
                  className="shrink-0 rounded-lg border border-cyan-300 px-3 py-1.5 text-xs text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300"
                >
                  Broadcast
                </button>
              )}
            </div>
            <div className="mt-3">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search this conversation"
                className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 dark:border-slate-700"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <p>
                  Total: {messageStats.total} | Mine: {messageStats.mine} | Today: {messageStats.todayCount} | Avg words: {messageStats.avgWords}
                </p>
                {searchTerm && (
                  <button type="button" onClick={() => setSearchTerm("")} className="underline underline-offset-2">
                    Clear Search
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="relative flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.7)_0%,rgba(241,245,249,0.7)_100%)] px-3 py-3 dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.5)_0%,rgba(15,23,42,0.55)_100%)] md:px-6 md:py-4">
            {isMessagesLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                <span className="mr-2">Loading conversation</span>
                <JumpingDots />
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filteredMessages.map((entry) => {
                const mine = entry.sender_id === currentUserId;
                const canDelete = mine || isAdmin;
                const isEditing = editingMessageId === entry.id;
                const isFavorite = Boolean(favoriteIds[entry.id]);
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[75%] md:px-4 ${mine ? "bg-cyan-500 text-slate-950" : "bg-white dark:bg-slate-800"}`}>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingMessageText}
                            onChange={(event) => setEditingMessageText(event.target.value)}
                            className="h-20 w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-600"
                          />
                          <div className="flex gap-2 text-[11px]">
                            <button type="button" onClick={() => void handleSaveEditMessage(entry.id)} className="underline underline-offset-2">
                              Save
                            </button>
                            <button type="button" onClick={() => setEditingMessageId(null)} className="underline underline-offset-2">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entry.media_url && entry.media_type === "image" && (
                            <a href={entry.media_url} target="_blank" rel="noreferrer">
                              <img src={entry.media_url} alt="Shared attachment" className="max-h-72 w-full rounded-xl object-cover" loading="lazy" />
                            </a>
                          )}
                          {entry.media_url && entry.media_type === "video" && (
                            <video src={entry.media_url} controls className="max-h-72 w-full rounded-xl object-cover" />
                          )}
                          <p className="whitespace-pre-wrap break-words">{entry.message}</p>
                        </div>
                      )}
                      <div className="mt-1 space-y-1 text-[11px] opacity-80">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {formatTime(entry.timestamp)}
                            {entry.edited_at ? " (edited)" : ""}
                          </span>
                          {mine && <span>{entry.seen_status ? "Seen" : "Delivered"}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button type="button" onClick={() => toggleFavoriteMessage(entry.id)} className="text-[10px] underline underline-offset-2">
                            {isFavorite ? "Unstar" : "Star"}
                          </button>
                          <button type="button" onClick={() => setReplyTo(entry)} className="text-[10px] underline underline-offset-2">
                            Reply
                          </button>
                          <button type="button" onClick={() => void copyMessage(entry.message)} className="text-[10px] underline underline-offset-2">
                            Copy
                          </button>
                          {mine && !isEditing && (
                            <button type="button" onClick={() => handleStartEditMessage(entry)} className="text-[10px] underline underline-offset-2">
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" onClick={() => handleDeleteMessage(entry.id, canDelete)} className="text-[10px] underline underline-offset-2">
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
                })}
              </AnimatePresence>
            )}
            {!isMessagesLoading && filteredMessages.length === 0 && (
              <p className="text-center text-xs text-slate-500">No messages found for your search.</p>
            )}
            <div ref={messageEndRef} />
          </div>

          <div className="border-t border-slate-200 bg-slate-100/95 px-3 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:px-6">
            <div className="mb-2 min-h-5 text-xs text-slate-500">
              {typingNames ? (
                <span className="inline-flex items-center gap-2">
                  <span>{typingNames} is typing</span>
                  <JumpingDots />
                </span>
              ) : (
                ""
              )}
            </div>
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {quickIcebreakers.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleDraftChange(prompt)}
                  className="shrink-0 rounded-full border border-cyan-200 px-2.5 py-1 text-xs text-cyan-700 dark:border-cyan-600/40 dark:text-cyan-300"
                >
                  {prompt}
                </button>
              ))}
              {quickReplies.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => handleDraftChange(entry)}
                  className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
                >
                  {entry}
                </button>
              ))}
              {emojiReactions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleDraftChange(`${draft}${emoji}`)}
                  className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
            {replyTo && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-cyan-300/50 bg-cyan-50 px-3 py-2 text-xs text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-200">
                <span className="truncate">Replying to: {replyTo.message}</span>
                <button type="button" onClick={() => setReplyTo(null)} className="underline underline-offset-2">
                  Cancel
                </button>
              </div>
            )}
            {mediaPreview && (
              <div className="mb-2 rounded-lg border border-slate-300 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>{mediaFile?.name}</span>
                  <button type="button" onClick={clearMediaDraft} className="underline underline-offset-2">
                    Remove
                  </button>
                </div>
                {mediaFile?.type.startsWith("video/") ? (
                  <video src={mediaPreview} controls className="max-h-60 w-full rounded-lg object-cover" />
                ) : (
                  <img src={mediaPreview} alt="Media preview" className="max-h-60 w-full rounded-lg object-cover" />
                )}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <textarea
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                placeholder={activeRecipientId ? "Type your message..." : "Select a conversation"}
                disabled={!activeRecipientId}
                className="h-20 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:opacity-60 dark:border-slate-700 sm:h-20"
              />
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:items-center sm:justify-end">
                <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-center text-xs dark:border-slate-700">
                  Media
                  <input type="file" accept="image/*,video/*" onChange={handlePickMedia} className="hidden" />
                </label>
                <button
                  type="button"
                  disabled={!activeRecipientId || isMediaUploading}
                  onClick={() => {
                    void handleSendMessage();
                  }}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                >
                  {isSending || isMediaUploading ? (
                    <span className="inline-flex items-center gap-2">
                      {isMediaUploading ? "Uploading" : "Sending"}
                      <JumpingDots />
                    </span>
                  ) : (
                    "Send"
                  )}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{draft.length} chars. Press Enter to send, Shift+Enter for newline.</p>
            {authError && <p className="mt-2 text-xs text-rose-500">{authError}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
