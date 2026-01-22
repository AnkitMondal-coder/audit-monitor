-- Drop the overly permissive ALL policy on user_roles
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

-- Create separate, more restrictive policies for each operation
-- INSERT: Admins can insert new roles, but cannot assign admin role without being existing admin
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  AND user_id != auth.uid() -- Cannot modify own roles
);

-- UPDATE: Admins can update roles, but cannot modify their own role
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND user_id != auth.uid() -- Cannot modify own role
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  AND user_id != auth.uid()
);

-- DELETE: Admins can delete roles, but cannot delete their own role
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND user_id != auth.uid() -- Cannot delete own role
);