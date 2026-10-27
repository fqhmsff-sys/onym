import 'package:flutter/material.dart';

class OC {
  static const like = Color(0xFFFF3040);
  static const star = Color(0xFFFFB400);
}

ThemeData buildTheme(Brightness b) {
  final dark = b == Brightness.dark;
  final bg = dark ? const Color(0xFF101010) : Colors.white;
  final fg = dark ? const Color(0xFFF3F5F7) : Colors.black;
  final soft = dark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F5F5);
  final line = dark ? const Color(0xFF2E2E2E) : const Color(0xFFEBEBEB);
  final cs = ColorScheme(
    brightness: b, primary: fg, onPrimary: bg, secondary: fg, onSecondary: bg, error: const Color(0xFFE5484D), onError: Colors.white,
    surface: bg, onSurface: fg, surfaceContainerHighest: soft, outline: line, outlineVariant: line,
  );
  final r12 = BorderRadius.circular(12);
  return ThemeData(
    useMaterial3: true, colorScheme: cs, scaffoldBackgroundColor: bg, canvasColor: bg, dividerColor: line, splashFactory: NoSplash.splashFactory,
    appBarTheme: AppBarTheme(backgroundColor: bg, foregroundColor: fg, elevation: 0, scrolledUnderElevation: 0, centerTitle: false,
        titleTextStyle: TextStyle(color: fg, fontSize: 17, fontWeight: FontWeight.w700)),
    textTheme: const TextTheme(bodyMedium: TextStyle(fontSize: 15.5, height: 1.3), bodyLarge: TextStyle(fontSize: 16, height: 1.3)),
    inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: soft, border: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide.none), focusedBorder: OutlineInputBorder(borderRadius: r12, borderSide: BorderSide(color: line, width: 1)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), hintStyle: const TextStyle(color: Color(0xFF999999))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(0, 46), backgroundColor: fg, foregroundColor: bg, disabledBackgroundColor: soft, disabledForegroundColor: const Color(0xFFB0B0B0),
        shape: RoundedRectangleBorder(borderRadius: r12), textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40), side: BorderSide(color: line), foregroundColor: fg, shape: RoundedRectangleBorder(borderRadius: r12),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5))),
    tabBarTheme: TabBarThemeData(labelColor: fg, unselectedLabelColor: const Color(0xFF999999), indicatorColor: fg, dividerColor: line, indicatorSize: TabBarIndicatorSize.tab, labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15), unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: fg)),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: fg)),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: bg, showDragHandle: true, shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22)))),
    dialogTheme: DialogThemeData(backgroundColor: bg, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20))),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: fg, contentTextStyle: TextStyle(color: bg), shape: RoundedRectangleBorder(borderRadius: r12)),
    dividerTheme: DividerThemeData(color: line, space: 0.5, thickness: 0.5),
    switchTheme: SwitchThemeData(thumbColor: WidgetStatePropertyAll(bg), trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? fg : const Color(0xFFD0D0D0)), trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent)),
    checkboxTheme: CheckboxThemeData(fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? fg : Colors.transparent), checkColor: WidgetStatePropertyAll(bg)),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: fg),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: ZoomPageTransitionsBuilder(),
      TargetPlatform.iOS: ZoomPageTransitionsBuilder(),
    }),
  );
}
