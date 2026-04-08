import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createClient, type RealtimeChannel, type Session } from "@supabase/supabase-js";
import { JumpingDots } from "./components/JumpingDots";
import { emojiReactions, quickIcebreakers, quickReplies } from "./lib/chat-constants";
import { formatDateTime, formatTime } from "./lib/date-format";
import type {
  ManagedProfileDraft,
  Message,
  OnlinePresence,
  Profile,
  ReminderItem,
  UserSort,
} from "./types/chat";
import { isSingleRowCoerceError } from "./utils/supabase-errors";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(supabaseUrl && supabaseAnonKey);
const supabase = configured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;


export default function App() {
  const prefersReducedMotion = useReducedMotion();
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
  const [userSort, setUserSort] = useState<UserSort>("active");
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
  const [autoWelcomeEnabled, setAutoWelcomeEnabled] = useState(true);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isSavingManagedUser, setIsSavingManagedUser] = useState(false);
  const [managedProfileDraft, setManagedProfileDraft] = useState<ManagedProfileDraft>({
    full_name: "",
    nickname: "",
    interests: "",
    hobbies: "",
    favorite_color: "",
    favorite_food: "",
    bio: "",
  });

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);

  const isAdmin = profile?.role === "admin";
  const currentUserId = session?.user.id ?? "";
  const activeAdminProfile = profiles.find((entry) => entry.role === "admin");
  const activeRecipientId = isAdmin ? selectedUserId : activeAdminProfile?.user_id ?? "";
  const isUserBlocked = !isAdmin && Boolean(profile?.blocked);

  const totalUnread = useMemo(() => {
    return Object.values(unreadByUser).reduce((sum, count) => sum + count, 0);
  }, [unreadByUser]);

  const visibleUsers = useMemo(() => {
    const base = profiles.filter((entry) => entry.role === "user");
    const filtered = base
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

    const sorted = [...filtered].sort((a, b) => {
      if (userSort === "newest") {
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      }
      if (userSort === "name") {
        const aName = `${a.nickname ?? ""}${a.full_name ?? ""}`.trim().toLowerCase();
        const bName = `${b.nickname ?? ""}${b.full_name ?? ""}`.trim().toLowerCase();
        return aName.localeCompare(bName);
      }
      const aScore = (unreadByUser[a.user_id] ?? 0) + (onlineUsers[a.user_id] ? 2 : 0);
      const bScore = (unreadByUser[b.user_id] ?? 0) + (onlineUsers[b.user_id] ? 2 : 0);
      return bScore - aScore;
    });

    return sorted;
  }, [profiles, userFilter, unreadByUser, userSearch, onlineUsers, userSort]);

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
        setActivityLogs((prev) => [`Login success at ${formatDateTime(new Date().toISOString())}`, ...prev].slice(0, 8));
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

    const profileChannel = supabase
      .channel(`realtime:profiles:${session.user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const updatedProfile = payload.new as Profile;
        setProfiles((prev) => prev.map((entry) => (entry.user_id === updatedProfile.user_id ? { ...entry, ...updatedProfile } : entry)));
        if (updatedProfile.user_id === session.user.id) {
          setProfile((prev) => (prev ? { ...prev, ...updatedProfile } : updatedProfile));
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(profileChannel);
    };
  }, [session?.user.id]);

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
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        const deleted = payload.old as Message;
        setMessages((prev) => prev.filter((msg) => msg.id !== deleted.id));
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

    let cancelled = false;

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
        if (!cancelled) {
          setIsMessagesLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setMessages((data ?? []) as Message[]);
        setUnreadByUser((prev) => ({ ...prev, [activeRecipientId]: 0 }));
      }

      await supabase
        .from("messages")
        .update({ seen_status: true })
        .eq("receiver_id", session.user.id)
        .eq("sender_id", activeRecipientId)
        .eq("seen_status", false);

      if (!cancelled) {
        setIsMessagesLoading(false);
      }
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!supabase || !isAdmin || !session?.user.id || !selectedUserId || !autoWelcomeEnabled || isMessagesLoading) {
      return;
    }
    if (messages.length > 0) {
      return;
    }

    const key = `crushconnect-welcomed:${session.user.id}`;
    const welcomed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[];
    if (welcomed.includes(selectedUserId)) {
      return;
    }

    const sendAutoWelcome = async () => {
      const { error } = await supabase.from("messages").insert({
        sender_id: session.user.id,
        receiver_id: selectedUserId,
        message: "Hi and welcome. I am glad you are here. Feel free to share your day.",
        timestamp: new Date().toISOString(),
        seen_status: false,
      });
      if (!error) {
        window.localStorage.setItem(key, JSON.stringify([...welcomed, selectedUserId]));
      }
    };

    void sendAutoWelcome();
  }, [supabase, isAdmin, session?.user.id, selectedUserId, autoWelcomeEnabled, isMessagesLoading, messages.length]);

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
    setTypingStatus({});
  }, [activeRecipientId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

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
    if (!supabase || !session?.user.id || !activeRecipientId || isUserBlocked || (!draft.trim() && !mediaFile)) {
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
    setAuthError("");
  };

  const handleProfileAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!supabase || !profile) {
      return;
    }
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setAuthError("Profile picture must be an image.");
      return;
    }

    setIsAvatarUploading(true);
    const extension = file.name.split(".").pop() ?? "png";
    const path = `${profile.user_id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
    if (uploadError) {
      setAuthError(uploadError.message);
      setIsAvatarUploading(false);
      return;
    }

    const { data: publicData } = supabase.storage.from("chat-media").getPublicUrl(path);
    const avatarUrl = publicData.publicUrl;
    const { error: updateError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", profile.user_id);
    if (updateError) {
      setAuthError(updateError.message);
      setIsAvatarUploading(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
    setProfiles((prev) => prev.map((entry) => (entry.user_id === profile.user_id ? { ...entry, avatar_url: avatarUrl } : entry)));
    setProfileStatus("Profile picture updated.");
    setIsAvatarUploading(false);
    event.target.value = "";
  };

  const handleAdminSaveManagedUser = async () => {
    if (!supabase || !selectedUser) {
      return;
    }
    setIsSavingManagedUser(true);
    const { error } = await supabase.from("profiles").update(managedProfileDraft).eq("user_id", selectedUser.user_id);
    if (error) {
      setAuthError(error.message);
      setIsSavingManagedUser(false);
      return;
    }
    setProfiles((prev) => prev.map((entry) => (entry.user_id === selectedUser.user_id ? { ...entry, ...managedProfileDraft } : entry)));
    setProfileStatus("User profile updated by admin.");
    setIsSavingManagedUser(false);
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

    const current = messages.find((entry) => entry.id === messageId);
    const cleaned = editingMessageText.trim();
    if (!current || current.message === cleaned) {
      setEditingMessageId(null);
      setEditingMessageText("");
      return;
    }

    const editedAt = new Date().toISOString();
    let { error } = await supabase
      .from("messages")
      .update({ message: cleaned, edited_at: editedAt })
      .eq("id", messageId);

    if (error && error.message.includes("edited_at")) {
      const fallback = await supabase
        .from("messages")
        .update({ message: cleaned })
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
              message: cleaned,
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
      <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_85%_15%,rgba(99,102,241,0.3),transparent_36%),radial-gradient(circle_at_50%_85%,rgba(14,165,233,0.15),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(15,23,42,0.9),rgba(2,6,23,0.94))]" />
        <motion.section
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6 md:py-16"
        >
          <div className="grid w-full items-center gap-8 md:grid-cols-[1.1fr_minmax(0,420px)] md:gap-12">
            <div className="space-y-6">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/90">CrushConnect</p>
              <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-white sm:text-5xl md:text-6xl">
                Secure chat made elegant, warm, and personal.
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
                Sign in once and your role is detected automatically. The app opens the correct workspace for user or admin,
                with realtime messaging, presence, and private conversation history.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/80 sm:text-sm">
                <span className="rounded-full border border-white/15 px-3 py-1">Supabase Auth</span>
                <span className="rounded-full border border-white/15 px-3 py-1">Realtime Typing</span>
                <span className="rounded-full border border-white/15 px-3 py-1">Private Role Routing</span>
              </div>
            </div>

            <form
              onSubmit={handleAuthSubmit}
              className="space-y-4 rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl shadow-cyan-900/25 backdrop-blur-xl sm:p-7"
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`w-1/2 rounded-xl px-3 py-2 text-sm ${authMode === "login" ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-slate-100"}`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`w-1/2 rounded-xl px-3 py-2 text-sm ${authMode === "signup" ? "bg-cyan-400 text-slate-900" : "bg-white/10 text-slate-100"}`}
                >
                  Sign Up
                </button>
              </div>

              <p className="text-xs text-slate-300">Role is auto-detected after login based on your profile record.</p>

              <input
                required
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
                type="email"
                placeholder="Email"
              />
              <input
                required
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
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
                    className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
                    placeholder="Full name"
                  />
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
                    placeholder="Nickname"
                  />
                  <input
                    value={interests}
                    onChange={(event) => setInterests(event.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
                    placeholder="Interests"
                  />
                  <input
                    value={hobbies}
                    onChange={(event) => setHobbies(event.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-cyan-300"
                    placeholder="Hobbies"
                  />
                </>
              )}

              {authError && <p className="text-sm text-rose-300">{authError}</p>}
              {authInfo && <p className="text-sm text-cyan-200">{authInfo}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
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
  const adminStats = useMemo(() => {
    const users = profiles.filter((entry) => entry.role === "user");
    const online = users.filter((entry) => Boolean(onlineUsers[entry.user_id])).length;
    const blocked = users.filter((entry) => Boolean(entry.blocked)).length;
    const unread = Object.values(unreadByUser).reduce((sum, value) => sum + value, 0);
    return { totalUsers: users.length, online, blocked, unread };
  }, [profiles, onlineUsers, unreadByUser]);

  useEffect(() => {
    if (!selectedUser) {
      setManagedProfileDraft({
        full_name: "",
        nickname: "",
        interests: "",
        hobbies: "",
        favorite_color: "",
        favorite_food: "",
        bio: "",
      });
      return;
    }
    setManagedProfileDraft({
      full_name: selectedUser.full_name ?? "",
      nickname: selectedUser.nickname ?? "",
      interests: selectedUser.interests ?? "",
      hobbies: selectedUser.hobbies ?? "",
      favorite_color: selectedUser.favorite_color ?? "",
      favorite_food: selectedUser.favorite_food ?? "",
      bio: selectedUser.bio ?? "",
    });
  }, [selectedUser?.user_id]);

  const typingNames = Object.values(typingStatus).join(", ");
  const enterTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const };
  const panelMotion = prefersReducedMotion
    ? { initial: { opacity: 1, x: 0 }, animate: { opacity: 1, x: 0 } }
    : { initial: { opacity: 0, x: -18 }, animate: { opacity: 1, x: 0 } };
  const chatMotion = prefersReducedMotion
    ? { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_55%,#eef6ff_100%)] text-slate-900 transition-colors dark:bg-[linear-gradient(180deg,#020617_0%,#0b1220_55%,#101a2c_100%)] dark:text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-400/15" />
      <div className="pointer-events-none absolute -right-24 top-24 h-64 w-64 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-400/20" />
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/75">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={enterTransition}>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-500">CrushConnect</p>
            <h1 className="text-lg font-semibold">{isAdmin ? "Admin Console" : "Private Chat"}</h1>
          </motion.div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <span className="rounded-full border border-cyan-400/40 px-3 py-1 capitalize">{profile.role}</span>
            <span className="hidden text-slate-500 md:inline">Unread: {totalUnread}</span>
            <span className="hidden text-slate-500 md:inline">Online: {Object.keys(onlineUsers).length}</span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setMobilePane((prev) => (prev === "chat" ? "panel" : "chat"))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:hidden"
              >
                {mobilePane === "chat" ? "Open Panel" : "Open Chat"}
              </button>
            )}
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
              {isAdmin ? (showProfilePanel ? "Hide Profile" : "Show Profile") : "Profile"}
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

      <div className={`mx-auto grid max-w-7xl gap-0 ${isAdmin ? "md:grid-cols-[340px_minmax(0,1fr)]" : "md:grid-cols-1"}`}>
        {isAdmin && (
          <motion.aside
            initial={panelMotion.initial}
            animate={panelMotion.animate}
            transition={enterTransition}
            className={`${mobilePane === "panel" ? "block" : "hidden"} border-r border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/75 md:block`}
          >
            <div className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold">Users</h2>
                <p className="text-xs text-slate-500">Manage access and open private chats.</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-slate-500">Total Users</p>
                  <p className="text-base font-semibold">{adminStats.totalUsers}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-slate-500">Online</p>
                  <p className="text-base font-semibold">{adminStats.online}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-slate-500">Blocked</p>
                  <p className="text-base font-semibold">{adminStats.blocked}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-slate-500">Unread</p>
                  <p className="text-base font-semibold">{adminStats.unread}</p>
                </div>
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
                <select
                  value={userSort}
                  onChange={(event) => setUserSort(event.target.value as UserSort)}
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-xs dark:border-slate-700"
                >
                  <option value="active">Sort: Active</option>
                  <option value="newest">Sort: Newest</option>
                  <option value="name">Sort: Name</option>
                </select>
              </div>

              <div className="space-y-2">
                {visibleUsers.map((entry) => {
                    const isOnline = Boolean(onlineUsers[entry.user_id]);
                    const isSelected = selectedUserId === entry.user_id;
                    return (
                        <motion.button
                        whileHover={{ x: 3 }}
                        whileTap={{ scale: 0.99 }}
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
                        <div className="flex items-center justify-between gap-2 text-sm font-medium">
                          <span className="flex min-w-0 items-center gap-2">
                            {entry.avatar_url ? (
                              <img src={entry.avatar_url} alt="avatar" className="h-7 w-7 rounded-full object-cover" loading="lazy" />
                            ) : (
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                {(entry.nickname || entry.full_name || "U").slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="truncate">{entry.nickname || entry.full_name || "Unnamed"}</span>
                          </span>
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOnline ? "bg-emerald-400" : "bg-slate-400"}`} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{entry.email}</div>
                        {(unreadByUser[entry.user_id] ?? 0) > 0 && <div className="mt-1 text-xs text-cyan-600">{unreadByUser[entry.user_id]} unread</div>}
                      </motion.button>
                    );
                  })}
              </div>

              {selectedUser && (
                <div className="space-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Manage User Information</p>
                  <input
                    value={managedProfileDraft.full_name}
                    onChange={(event) => setManagedProfileDraft((prev) => ({ ...prev, full_name: event.target.value }))}
                    placeholder="Full name"
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-xs dark:border-slate-700"
                  />
                  <input
                    value={managedProfileDraft.nickname}
                    onChange={(event) => setManagedProfileDraft((prev) => ({ ...prev, nickname: event.target.value }))}
                    placeholder="Nickname"
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-xs dark:border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleAdminSaveManagedUser();
                    }}
                    className="w-full rounded-lg border border-indigo-300 px-3 py-2 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300"
                  >
                    {isSavingManagedUser ? "Saving..." : "Save User Profile"}
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setAutoWelcomeEnabled((prev) => !prev)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    Auto Welcome: {autoWelcomeEnabled ? "On" : "Off"}
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
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="My avatar" className="h-12 w-12 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/20 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                      {(nickname || fullName || "U").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <label className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700">
                    {isAvatarUploading ? "Uploading..." : "Upload Photo"}
                    <input type="file" accept="image/*" onChange={handleProfileAvatarUpload} className="hidden" />
                  </label>
                </div>
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
          </motion.aside>
        )}

        <motion.section
          initial={chatMotion.initial}
          animate={chatMotion.animate}
          transition={enterTransition}
          className={`${isAdmin ? (mobilePane === "chat" ? "flex" : "hidden") : "flex"} h-[calc(100dvh-70px)] min-w-0 flex-col md:h-[calc(100dvh-69px)] md:flex`}
        >
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
                  {isUserBlocked
                    ? "Your account is currently blocked. Contact admin for access."
                    : activeRecipientId && onlineUsers[activeRecipientId]
                    ? "Online now"
                    : activeRecipientId
                      ? "Offline now. You can still send messages."
                      : "No recipient available yet."}
                </p>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setMobilePane("panel")}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 md:hidden"
                >
                  Back
                </button>
              )}

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

          <div className="relative flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_75%_0%,rgba(34,211,238,0.08),transparent_30%),linear-gradient(180deg,rgba(248,250,252,0.75)_0%,rgba(241,245,249,0.75)_100%)] px-2.5 py-3 dark:bg-[radial-gradient(circle_at_75%_0%,rgba(14,165,233,0.1),transparent_30%),linear-gradient(180deg,rgba(2,6,23,0.52)_0%,rgba(15,23,42,0.56)_100%)] md:px-6 md:py-4">
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
                    layout
                    initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.99 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.24, ease: "easeOut" }}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[94%] rounded-2xl px-3 py-2 text-sm shadow-[0_8px_24px_-18px_rgba(15,23,42,0.9)] md:max-w-[76%] md:px-4 ${mine ? "bg-gradient-to-br from-cyan-400 to-cyan-500 text-slate-950" : "bg-white/95 dark:bg-slate-800/95"}`}>
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

          <div className="border-t border-slate-200/80 bg-white/90 px-3 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85 md:px-6">
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
                  disabled={isUserBlocked}
                  onClick={() => handleDraftChange(prompt)}
                  className="shrink-0 rounded-full border border-cyan-200 px-2.5 py-1 text-xs text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-600/40 dark:text-cyan-300"
                >
                  {prompt}
                </button>
              ))}
              {quickReplies.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  disabled={isUserBlocked}
                  onClick={() => handleDraftChange(entry)}
                  className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700"
                >
                  {entry}
                </button>
              ))}
              {emojiReactions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={isUserBlocked}
                  onClick={() => handleDraftChange(`${draft}${emoji}`)}
                  className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700"
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
                disabled={!activeRecipientId || isUserBlocked}
                className="h-20 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:opacity-60 dark:border-slate-700 sm:h-20"
              />
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:items-center sm:justify-end">
                <label className={`rounded-lg border border-slate-300 px-3 py-2 text-center text-xs dark:border-slate-700 ${isUserBlocked ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}>
                  Media
                  <input type="file" accept="image/*,video/*" onChange={handlePickMedia} disabled={isUserBlocked} className="hidden" />
                </label>
                <button
                  type="button"
                  disabled={!activeRecipientId || isMediaUploading || isUserBlocked}
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
            {profileStatus && <p className="mt-1 text-xs text-cyan-600 dark:text-cyan-300">{profileStatus}</p>}
            {authError && <p className="mt-2 text-xs text-rose-500">{authError}</p>}
          </div>
        </motion.section>
      </div>

      {!isAdmin && showProfilePanel && (
        <div className="fixed inset-0 z-30 bg-slate-950/60 p-3 backdrop-blur-sm md:p-6" onClick={() => setShowProfilePanel(false)}>
          <div
            className="mx-auto h-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Your Profile</h2>
              <button type="button" onClick={() => setShowProfilePanel(false)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-700">
                Close
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="My avatar" className="h-14 w-14 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500/20 text-base font-semibold text-cyan-700 dark:text-cyan-300">
                    {(nickname || fullName || "U").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <label className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700">
                  {isAvatarUploading ? "Uploading..." : "Upload Profile Picture"}
                  <input type="file" accept="image/*" onChange={handleProfileAvatarUpload} className="hidden" />
                </label>
              </div>
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
            </div>

            <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
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
              <div className="max-h-40 space-y-2 overflow-y-auto text-xs">
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
              <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
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
          </div>
        </div>
      )}
    </main>
  );
}
