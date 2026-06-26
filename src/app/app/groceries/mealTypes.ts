export type Dish = {
  id: string;
  name: string;
  cook_id: string | null;
  recipe_url: string | null;
  recipe_file_url: string | null;
  notes: string | null;
  created_at: string;
};

export type DishIngredient = {
  id: string;
  dish_id: string;
  ingredient: string;
  quantity: number;
};

export type DishFavorite = {
  dish_id: string;
  user_id: string;
};

export type MealLogEntry = {
  id: string;
  dish_id: string;
  made_on: string; // YYYY-MM-DD
  has_leftovers: boolean;
  created_at: string;
};

export type InventoryLite = {
  id: string;
  name: string;
  quantity: number;
};

export type Suggestion = {
  id: string;
  text: string;
  suggested_by: string;
  created_at: string;
};

export type SuggestionVote = {
  suggestion_id: string;
  user_id: string;
};
