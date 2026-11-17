DROP POLICY IF EXISTS "Anyone reads settings" ON public.app_settings;
CREATE POLICY "Admins read settings" ON public.app_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE SELECT ON public.app_settings FROM anon;