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
};

type OnlinePresence = {
  user_id: string;
  name: string;
  role: Role;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(supabaseUrl && supabaseAnonKey);
const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.toLowerCase().trim();

const supabase = configured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

const emojiReactions = ["❤️", "😊", "🔥", "👍", "😂"];

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

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
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

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);

  const isAdmin = profile?.role === "admin";
  const currentUserId = session?.user.id ?? "";
  const activeRecipientId = isAdmin ? selectedUserId : profiles.find((p) => p.role === "admin")?.user_id ?? "";

  const totalUnread = useMemo(() => {
    return Object.values(unreadByUser).reduce((sum, count) => sum + count, 0);
  }, [unreadByUser]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

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
    if (!supabase || !session?.user.id) {
      return;
    }

    const ensureProfile = async () => {
      const { data: existing, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle<Profile>();

      if (fetchError) {
        setAuthError(fetchError.message);
        return;
      }

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

      const newRole: Role = adminEmail && session.user.email?.toLowerCase() === adminEmail ? "admin" : "user";
      const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({
          user_id: session.user.id,
          email: session.user.email,
          role: newRole,
          full_name: session.user.user_metadata.full_name ?? "",
          nickname: session.user.user_metadata.nickname ?? "",
          interests: session.user.user_metadata.interests ?? "",
          hobbies: session.user.user_metadata.hobbies ?? "",
          favorite_food: "",
          favorite_color: "",
          bio: "",
          blocked: false,
        })
        .select("*")
        .single<Profile>();

      if (createError) {
        setAuthError(createError.message);
      } else {
        setProfile(created);
      }
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
          setMessages((prev) => [...prev, newMessage]);
        } else if (newMessage.receiver_id === session.user.id) {
          setUnreadByUser((prev) => ({ ...prev, [newMessage.sender_id]: (prev[newMessage.sender_id] ?? 0) + 1 }));
        }

        setActivityLogs((prev) => [
          `New message ${newMessage.receiver_id === session.user.id ? "received" : "sent"} at ${formatDateTime(newMessage.timestamp)}`,
          ...prev,
        ].slice(0, 8));

        if (newMessage.receiver_id === session.user.id && document.visibilityState !== "visible" && "Notification" in window) {
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
  }, [session?.user.id, activeRecipientId]);

  useEffect(() => {
    if (!supabase || !session?.user.id || !activeRecipientId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${session.user.id},receiver_id.eq.${activeRecipientId}),and(sender_id.eq.${activeRecipientId},receiver_id.eq.${session.user.id})`,
        )
        .order("timestamp", { ascending: true });

      if (error) {
        setAuthError(error.message);
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
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      return;
    }
    setAuthError("");
    setAuthInfo("");
    setIsSubmitting(true);

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
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
        email: authEmail,
        password: authPassword,
      });

      if (error) {
        setAuthError(error.message);
      } else if (loginRole === "admin" && adminEmail && authEmail.toLowerCase() !== adminEmail) {
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

  const handleSendMessage = async () => {
    if (!supabase || !session?.user.id || !activeRecipientId || !draft.trim()) {
      return;
    }

    const payload = {
      sender_id: session.user.id,
      receiver_id: activeRecipientId,
      message: draft.trim(),
      timestamp: new Date().toISOString(),
      seen_status: false,
    };

    setDraft("");
    sendTypingSignal(false);

    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      setAuthError(error.message);
    }
  };

  const handleProfileSave = async () => {
    if (!supabase || !profile) {
      return;
    }

    const { data, error } = await supabase
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
      .eq("user_id", profile.user_id)
      .select("*")
      .single<Profile>();

    if (error) {
      setProfileStatus(error.message);
      return;
    }

    setProfile(data);
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

  const handleDeleteMessage = async (messageId: string) => {
    if (!supabase || !isAdmin) {
      return;
    }

    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setMessages((prev) => prev.filter((entry) => entry.id !== messageId));
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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.28),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.2),transparent_35%)]" />
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

            <form onSubmit={handleAuthSubmit} className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm ${authMode === "login" ? "bg-cyan-400 text-slate-900" : "bg-white/10"}`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm ${authMode === "signup" ? "bg-cyan-400 text-slate-900" : "bg-white/10"}`}
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
    <main className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-500">CrushConnect</p>
            <h1 className="text-lg font-semibold">{isAdmin ? "Admin Console" : "Private Chat"}</h1>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full border border-cyan-400/40 px-3 py-1 capitalize">{profile.role}</span>
            <span className="hidden text-slate-500 md:inline">Unread: {totalUnread}</span>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-700"
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-0 md:grid-cols-[280px_1fr]">
        <aside className="border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {isAdmin ? (
            <div className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold">Users</h2>
                <p className="text-xs text-slate-500">Manage access and open private chats.</p>
              </div>

              <div className="space-y-2">
                {profiles
                  .filter((entry) => entry.role === "user")
                  .map((entry) => {
                    const isOnline = Boolean(onlineUsers[entry.user_id]);
                    const isSelected = selectedUserId === entry.user_id;
                    return (
                      <motion.button
                        whileHover={{ x: 3 }}
                        key={entry.user_id}
                        type="button"
                        onClick={() => setSelectedUserId(entry.user_id)}
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
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Activity Log</p>
                {activityLogs.length === 0 ? <p>No recent activity.</p> : activityLogs.map((entry) => <p key={entry}>{entry}</p>)}
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-4">
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
              {profileStatus && <p className="text-xs text-slate-500">{profileStatus}</p>}
            </div>
          )}
        </aside>

        <section className="flex min-h-[calc(100vh-65px)] flex-col">
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
                  {activeRecipientId && onlineUsers[activeRecipientId] ? "Online now" : "Offline"}
                </p>
              </div>

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

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-6">
            <AnimatePresence initial={false}>
              {messages.map((entry) => {
                const mine = entry.sender_id === currentUserId;
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${mine ? "bg-cyan-500 text-slate-950" : "bg-slate-200 dark:bg-slate-800"}`}>
                      <p className="whitespace-pre-wrap">{entry.message}</p>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] opacity-80">
                        <span>{formatTime(entry.timestamp)}</span>
                        {mine && <span>{entry.seen_status ? "Seen" : "Delivered"}</span>}
                        {isAdmin && (
                          <button type="button" onClick={() => handleDeleteMessage(entry.id)} className="text-[10px] underline underline-offset-2">
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={messageEndRef} />
          </div>

          <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800 md:px-6">
            <div className="mb-2 min-h-5 text-xs text-slate-500">{typingNames ? `${typingNames} is typing...` : ""}</div>
            <div className="mb-2 flex flex-wrap gap-2">
              {emojiReactions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleDraftChange(`${draft}${emoji}`)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                placeholder={activeRecipientId ? "Type your message..." : "Select a conversation"}
                disabled={!activeRecipientId}
                className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:opacity-60 dark:border-slate-700"
              />
              <button
                type="button"
                disabled={!activeRecipientId}
                onClick={() => {
                  void handleSendMessage();
                }}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {authError && <p className="mt-2 text-xs text-rose-500">{authError}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
