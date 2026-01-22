-- Add DELETE policy for transactions table
CREATE POLICY "Users can delete transactions from their sessions"
ON public.transactions
FOR DELETE
USING (session_id IN (
  SELECT id FROM analysis_sessions WHERE user_id = auth.uid()
));

-- Add DELETE policy for risk_assessments table
CREATE POLICY "Users can delete their risk assessments"
ON public.risk_assessments
FOR DELETE
USING (transaction_id IN (
  SELECT t.id FROM transactions t
  JOIN analysis_sessions s ON t.session_id = s.id
  WHERE s.user_id = auth.uid()
));

-- Add DELETE policy for analysis_sessions table
CREATE POLICY "Users can delete their own sessions"
ON public.analysis_sessions
FOR DELETE
USING (auth.uid() = user_id);