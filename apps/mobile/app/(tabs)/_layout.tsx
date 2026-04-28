// Tab navigator. Five tabs: Home, Book, Status (booking id slot),
// Autonomy (vehicle id slot), Me. Tabs that take a path parameter
// keep their last-visited id in AsyncStorage so the bottom-tab tap
// goes straight to the most recent record without forcing the user
// to navigate from the index again.

import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "@/providers/auth";
import { useI18n } from "@/i18n/index";
import { useTheme } from "@/theme/index";

const LAST_BOOKING_KEY = "vsbs.last.booking";
const LAST_VEHICLE_KEY = "vsbs.last.vehicle";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const { palette } = useTheme();
  return (
    <Text
      accessibilityElementsHidden
      style={{
        fontSize: 11,
        fontWeight: focused ? "700" : "500",
        color: focused ? palette.accent : palette.muted,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  const { ready, session } = useAuth();
  const { t } = useI18n();
  const { palette, spacing } = useTheme();
  const [lastBookingId, setLastBookingId] = useState<string>("demo");
  const [lastVehicleId, setLastVehicleId] = useState<string>("demo");

  useEffect(() => {
    AsyncStorage.getItem(LAST_BOOKING_KEY).then((v) => v && setLastBookingId(v));
    AsyncStorage.getItem(LAST_VEHICLE_KEY).then((v) => v && setLastVehicleId(v));
  }, []);

  if (!ready) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          paddingBottom: spacing.s,
          paddingTop: spacing.xs,
          height: 64,
        },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.app.name,
          tabBarLabel: ({ focused }) => <TabIcon label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="book"
        options={{
          title: t.book.title,
          tabBarLabel: ({ focused }) => <TabIcon label="Book" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="status/[id]"
        initialParams={{ id: lastBookingId }}
        options={{
          title: t.status.title,
          tabBarLabel: ({ focused }) => <TabIcon label="Status" focused={focused} />,
          href: { pathname: "/(tabs)/status/[id]", params: { id: lastBookingId } },
        }}
      />
      <Tabs.Screen
        name="autonomy/[id]"
        initialParams={{ id: lastVehicleId }}
        options={{
          title: t.autonomy.title,
          tabBarLabel: ({ focused }) => <TabIcon label="Autonomy" focused={focused} />,
          href: { pathname: "/(tabs)/autonomy/[id]", params: { id: lastVehicleId } },
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: t.me.title,
          tabBarLabel: ({ focused }) => <TabIcon label="Me" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
