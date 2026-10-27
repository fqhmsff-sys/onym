import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'data/models.dart';
import 'data/repo.dart';
import 'ui/auth_pages.dart';
import 'ui/compose_page.dart';
import 'ui/feed_pages.dart';
import 'ui/post_page.dart';
import 'ui/profile_page.dart';
import 'ui/settings_page.dart';
import 'ui/shell.dart';

GoRouter buildRouter() => GoRouter(
  refreshListenable: Repo.i,
  redirect: (ctx, st) {
    final signed = Repo.i.signedIn; final loc = st.matchedLocation;
    final pub = loc == '/login' || loc == '/register' || loc == '/recover';
    if (signed && Repo.i.pendingCodes != null && loc != '/codes') return '/codes';
    if (loc == '/codes' && (!signed || Repo.i.pendingCodes == null)) return '/';
    if (!signed && !pub) { final next = st.uri.toString(); return next == '/' ? '/login' : '/login?next=${Uri.encodeComponent(next)}'; }
    if (signed && pub) { final n = st.uri.queryParameters['next']; return (n != null && n.startsWith('/') && !n.startsWith('//')) ? n : '/'; } // cegah open-redirect
    return null;
  },
  errorBuilder: (c, s) => const Scaffold(body: Center(child: Text('404'))),
  routes: [
    GoRoute(path: '/', builder: (_, __) => const Shell()),
    GoRoute(path: '/login', builder: (_, __) => const LoginPage()),
    GoRoute(path: '/register', builder: (_, __) => const RegisterPage()),
    GoRoute(path: '/recover', builder: (_, __) => const RecoverPage()),
    GoRoute(path: '/codes', builder: (_, __) => const CodesPage()),
    GoRoute(path: '/p/:id', builder: (_, s) => PostPage(s.pathParameters['id']!, initial: s.extra is Post ? s.extra as Post : null)),
    GoRoute(path: '/u/:name', builder: (_, s) => ProfilePage(s.pathParameters['name']!.toLowerCase())),
    GoRoute(path: '/u/:name/followers', builder: (_, s) => FollowListPage(s.pathParameters['name']!.toLowerCase(), 'followers')),
    GoRoute(path: '/u/:name/following', builder: (_, s) => FollowListPage(s.pathParameters['name']!.toLowerCase(), 'following')),
    GoRoute(path: '/compose', builder: (_, s) => ComposePage(edit: s.extra is Post ? s.extra as Post : null)),
    GoRoute(path: '/search', builder: (_, __) => const SearchPage()),
    GoRoute(path: '/saved', builder: (_, __) => const SavedPage()),
    GoRoute(path: '/settings', builder: (_, __) => const SettingsPage()),
    GoRoute(path: '/relations', builder: (_, __) => const RelationsPage()),
    GoRoute(path: '/blocked', builder: (_, __) => const BlockedPage()),
    GoRoute(path: '/profile/edit', builder: (_, __) => const EditProfilePage()),
  ],
);
