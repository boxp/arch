inductive Action where
  | overlay | inside | outside | fresh
  deriving Repr, BEq, Inhabited

def step (shown : Bool) : Action → Bool
  | .overlay => shown
  | .inside => shown
  | .outside => false
  | .fresh => true

theorem overlay_preserves (s : Bool) : step s .overlay = s := rfl
theorem inside_preserves (s : Bool) : step s .inside = s := rfl
theorem outside_closes (s : Bool) : step s .outside = false := rfl
theorem fresh_shows (s : Bool) : step s .fresh = true := rfl

def actions : List Action := [.overlay, .inside, .outside, .fresh]
def traces : Nat → List (List Action)
  | 0 => [[]]
  | n + 1 => (traces n).flatMap fun t => actions.map (t ++ · :: [])
def encode : Action → String
  | .overlay => "overlay" | .inside => "inside" | .outside => "outside" | .fresh => "fresh"
def line (t : List Action) : String :=
  String.intercalate "," (t.map encode) ++ " " ++ if t.foldl step true then "1" else "0"
def main : IO Unit := IO.println (String.intercalate "\n" ((traces 3).map line))
