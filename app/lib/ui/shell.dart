import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'feed_pages.dart';
import 'notifications_page.dart';
import 'profile_page.dart';
import 'widgets.dart';

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> with WidgetsBindingObserver {
  int _i = 0; int _unread = 0; Timer? _t;
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); _poll(); _t = Timer.periodic(const Duration(minutes: 5), (_) => _poll()); }
  @override
  void dispose() { _t?.cancel(); WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) { if (s == AppLifecycleState.resumed) _poll(); }
  Future<void> _poll() async { final n = await Repo.i.unread(); if (mounted && n != _unread) setState(() => _unread = n); }
  Future<void> _write() async { final r = await context.push<Object?>('/compose'); if (r == true && mounted) { feedRefresh.value++; setState(() => _i = 0); } }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final mute = cs.onSurface.withValues(alpha: .38);
    final pages = <Widget>[
      const HomeTab(key: PageStorageKey('home')), const RandomTab(key: PageStorageKey('random')), const SizedBox.shrink(),
      NotificationsTab(key: const PageStorageKey('notif'), onRead: () => setState(() => _unread = 0)), const MeTab(key: PageStorageKey('me')),
    ];
    Widget nav(int idx, IconData off, IconData on, {Widget? badge}) => Expanded(child: InkResponse(radius: 28, onTap: () { setState(() => _i = idx); if (idx == 3) _poll(); },
      child: SizedBox(height: 52, child: Center(child: Stack(clipBehavior: Clip.none, children: [Icon(_i == idx ? on : off, size: 28, color: _i == idx ? cs.onSurface : mute), if (badge != null) Positioned(right: -2, top: -1, child: badge)])))));
    return Scaffold(
      body: SafeArea(bottom: false, child: IndexedStack(index: _i, children: pages)),
      bottomNavigationBar: Container(decoration: BoxDecoration(color: cs.surface, border: Border(top: BorderSide(color: cs.outline, width: .5))),
        child: SafeArea(top: false, child: Row(children: [
          nav(0, Icons.home_outlined, Icons.home_rounded),
          nav(1, Icons.shuffle, Icons.shuffle),
          Expanded(child: InkResponse(radius: 28, onTap: _write, child: SizedBox(height: 52, child: Center(child: Container(width: 58, height: 40, decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(13)), child: Icon(Icons.add, size: 28, color: mute.withValues(alpha: .8))))))),
          nav(3, Icons.favorite_border, Icons.favorite, badge: _unread > 0 ? Container(width: 9, height: 9, decoration: const BoxDecoration(color: OC.like, shape: BoxShape.circle)) : null),
          Expanded(child: InkResponse(radius: 28, onTap: () => setState(() => _i = 4), child: SizedBox(height: 52, child: Center(child: Container(decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: _i == 4 ? cs.onSurface : Colors.transparent, width: 1.6)), padding: const EdgeInsets.all(1.5),
              child: Avatar(keyPath: null, name: Repo.i.me?.displayName ?? '?', size: 28)))))),
        ]))),
    );
  }
}
