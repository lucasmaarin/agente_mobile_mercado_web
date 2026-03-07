"use client";
import React, { useState, useEffect } from "react";
import styles from "./Header.module.css";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { LogOut } from "lucide-react";
import Image from "next/image";

const Header: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const getFirstName = () => {
    if (user?.displayName) return user.displayName.split(" ")[0];
    if (user?.email) return user.email.split("@")[0];
    return "Usuário";
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.logoArea}>
        <Image src="/logo.png" alt="Agente Móbile" width={36} height={36} />
        <span className={styles.logoText}>Agente Móbile</span>
      </div>

      {user && (
        <div className={styles.userArea}>
          <span className={styles.greeting}>Olá, {getFirstName()}!</span>
          <button
            className={styles.logoutButton}
            onClick={handleLogout}
            title="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;
