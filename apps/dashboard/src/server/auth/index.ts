export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export async function getSession(): Promise<Session> {
  // Local development session
  return {
    user: {
      id: "local-dev",
      name: "Local User",
      email: "dev@localhost",
    },
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
