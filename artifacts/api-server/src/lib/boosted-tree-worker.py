import json
import os
import sys
import tempfile
import traceback

import numpy as np


HEADS = (
    ("result", 3),
    ("bothTeamsToScore", 2),
    ("overUnder25", 2),
    ("overUnder35", 2),
    ("correctScore", 36),
)


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")
    sys.stdout.flush()


def full_probabilities(raw, labels, class_count):
    raw = np.asarray(raw, dtype=np.float64)
    if raw.ndim == 1:
        if len(labels) == 2:
            raw = np.column_stack((1.0 - raw, raw))
        else:
            raw = raw.reshape(1, -1)
    probabilities = np.full((raw.shape[0], class_count), 1e-6, dtype=np.float64)
    for column, label in enumerate(labels):
        if 0 <= int(label) < class_count and column < raw.shape[1]:
            probabilities[:, int(label)] += np.maximum(raw[:, column], 0)
    totals = probabilities.sum(axis=1, keepdims=True)
    return probabilities / np.maximum(totals, 1e-12)


def log_loss(labels, probabilities):
    labels = np.asarray(labels, dtype=np.int64)
    if labels.size == 0:
        return 0.0
    selected = probabilities[np.arange(labels.size), labels]
    return float(-np.log(np.maximum(selected, 1e-12)).mean())


def loss_curve(values):
    if not values:
        return []
    return [float(value) for value in values if np.isfinite(float(value))]


def make_classifier(algorithm, class_count, rounds):
    if algorithm == "catboost":
        from catboost import CatBoostClassifier

        return CatBoostClassifier(
            iterations=rounds,
            depth=6,
            learning_rate=0.05,
            loss_function="MultiClass" if class_count > 2 else "Logloss",
            random_seed=42,
            verbose=False,
            thread_count=1,
            allow_writing_files=False,
            l2_leaf_reg=3.0,
        )

    if algorithm == "xgboost":
        import xgboost as xgb

        return xgb

    raise ValueError("Unsupported boosted-tree algorithm.")


def fit_head(algorithm, features, train_labels, validation_features, validation_labels, class_count, rounds):
    train_labels = np.asarray(train_labels, dtype=np.int64)
    validation_labels = np.asarray(validation_labels, dtype=np.int64)
    labels, counts = np.unique(train_labels, return_counts=True)

    if labels.size < 2:
        full_counts = np.zeros(class_count, dtype=np.float64)
        for label, count in zip(labels, counts):
            full_counts[int(label)] = float(count)
        probabilities = (full_counts + 1.0) / (train_labels.size + class_count)
        artifact = {"kind": "constant", "probabilities": probabilities.tolist()}
        train_probabilities = np.tile(probabilities, (train_labels.size, 1))
        validation_probabilities = np.tile(probabilities, (validation_labels.size, 1))
        return artifact, train_probabilities, validation_probabilities, [], []

    label_to_index = {int(label): index for index, label in enumerate(labels)}
    encoded_train = np.asarray([label_to_index[int(label)] for label in train_labels], dtype=np.int32)
    validation_mask = np.isin(validation_labels, labels)
    encoded_validation = np.asarray(
        [label_to_index[int(label)] for label in validation_labels[validation_mask]],
        dtype=np.int32,
    )
    known_validation_features = validation_features[validation_mask]
    metric_name = "MultiClass" if labels.size > 2 else "Logloss"
    training_values = []
    validation_values = []

    if algorithm == "catboost":
        model = make_classifier(algorithm, int(labels.size), rounds)
        fit_options = {}
        if encoded_validation.size:
            fit_options["eval_set"] = (known_validation_features, encoded_validation)
        model.fit(features, encoded_train, **fit_options)
        raw_train = model.predict_proba(features)
        raw_validation = model.predict_proba(validation_features)
        evaluations = model.get_evals_result()
        training_values = evaluations.get("learn", {}).get(metric_name, [])
        validation_values = evaluations.get("validation", {}).get(metric_name, [])

        with tempfile.TemporaryDirectory() as directory:
            model_path = os.path.join(directory, "model.json")
            model.save_model(model_path, format="json")
            with open(model_path, "r", encoding="utf-8") as model_file:
                model_json = model_file.read()
        model_artifact = {"kind": "model", "classLabels": labels.astype(int).tolist(), "modelJson": model_json}
    else:
        xgb = make_classifier(algorithm, int(labels.size), rounds)
        train_matrix = xgb.DMatrix(features, label=encoded_train)
        evaluations = {}
        eval_sets = [(train_matrix, "train")]
        if encoded_validation.size:
            validation_matrix = xgb.DMatrix(known_validation_features, label=encoded_validation)
            eval_sets.append((validation_matrix, "validation"))
        params = {
            "objective": "multi:softprob" if labels.size > 2 else "binary:logistic",
            "eval_metric": "mlogloss" if labels.size > 2 else "logloss",
            "max_depth": 4,
            "eta": 0.05,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "tree_method": "hist",
            "nthread": 1,
            "seed": 42,
        }
        if labels.size > 2:
            params["num_class"] = int(labels.size)
        model = xgb.train(
            params,
            train_matrix,
            num_boost_round=rounds,
            evals=eval_sets,
            evals_result=evaluations,
            verbose_eval=False,
        )
        raw_train = model.predict(train_matrix)
        raw_validation = model.predict(xgb.DMatrix(validation_features))
        metric_name = "mlogloss" if labels.size > 2 else "logloss"
        training_values = evaluations.get("train", {}).get(metric_name, [])
        validation_values = evaluations.get("validation", {}).get(metric_name, [])

        with tempfile.TemporaryDirectory() as directory:
            model_path = os.path.join(directory, "model.json")
            model.save_model(model_path)
            with open(model_path, "r", encoding="utf-8") as model_file:
                model_json = model_file.read()
        model_artifact = {"kind": "model", "classLabels": labels.astype(int).tolist(), "modelJson": model_json}

    train_probabilities = full_probabilities(raw_train, labels, class_count)
    validation_probabilities = full_probabilities(raw_validation, labels, class_count)
    return model_artifact, train_probabilities, validation_probabilities, loss_curve(training_values), loss_curve(validation_values)


def train(request):
    features = np.asarray(request["features"], dtype=np.float32)
    if features.ndim != 2 or features.shape[0] < 30 or features.shape[1] == 0:
        raise ValueError("Training requires at least 30 examples with a consistent feature vector.")
    features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
    sample_count = int(features.shape[0])
    training_count = int(request["trainingSampleCount"])
    if training_count < 1 or training_count >= sample_count:
        raise ValueError("The chronological training and validation split is invalid.")
    train_features = features[:training_count]
    validation_features = features[training_count:]
    rounds = max(1, min(100, int(request["rounds"])))
    algorithm = request["algorithm"]
    head_artifacts = {}
    result_training_loss = []
    result_validation_loss = []
    result_probabilities = None
    result_training_probabilities = None

    for head_index, (head_name, class_count) in enumerate(HEADS):
        labels = np.asarray(request["labels"][head_name], dtype=np.int64)
        if labels.shape[0] != sample_count or np.any(labels < 0) or np.any(labels >= class_count):
            raise ValueError("A training target does not match the feature rows or expected class range.")
        head_artifact, train_probabilities, validation_probabilities, train_curve, validation_curve = fit_head(
            algorithm,
            train_features,
            labels[:training_count],
            validation_features,
            labels[training_count:],
            class_count,
            rounds,
        )
        head_artifacts[head_name] = head_artifact

        if head_name == "result":
            result_training_loss = train_curve or [log_loss(labels[:training_count], train_probabilities)]
            result_validation_loss = validation_curve or [log_loss(labels[training_count:], validation_probabilities)]
            result_probabilities = validation_probabilities
            result_training_probabilities = train_probabilities

        emit({
            "type": "progress",
            "completedEpochs": max(1, round(rounds * (head_index + 1) / len(HEADS))),
            "trainingLoss": result_training_loss,
            "validationLoss": result_validation_loss,
        })

    validation_labels = np.asarray(request["labels"]["result"][training_count:], dtype=np.int64)
    training_labels = np.asarray(request["labels"]["result"][:training_count], dtype=np.int64)
    confusion = [[0, 0, 0] for _ in range(3)]
    predicted_labels = np.argmax(result_probabilities, axis=1)
    for actual, predicted in zip(validation_labels, predicted_labels):
        confusion[int(actual)][int(predicted)] += 1
    majority_label = int(np.bincount(training_labels, minlength=3).argmax())
    brier_score = float(np.square(
        result_probabilities - np.eye(3, dtype=np.float64)[validation_labels]
    ).sum(axis=1).mean())

    return {
        "sampleCount": sample_count,
        "trainingSampleCount": training_count,
        "validationSampleCount": sample_count - training_count,
        "accuracy": float(np.mean(predicted_labels == validation_labels)),
        "baselineAccuracy": float(np.mean(validation_labels == majority_label)),
        "logLoss": log_loss(validation_labels, result_probabilities),
        "brierScore": brier_score,
        "confusionMatrix": confusion,
        "trainingLoss": result_training_loss,
        "validationLoss": result_validation_loss,
        "predictorArtifact": {
            "version": 3,
            "algorithm": algorithm,
            "featureCount": int(features.shape[1]),
            "heads": head_artifacts,
        },
    }


def load_head_model(algorithm, head_artifact, directory):
    if head_artifact.get("kind") == "constant":
        return None
    if head_artifact.get("kind") != "model" or not isinstance(head_artifact.get("modelJson"), str):
        raise ValueError("A saved boosted-tree head is incomplete.")
    model_path = os.path.join(directory, "model.json")
    with open(model_path, "w", encoding="utf-8") as model_file:
        model_file.write(head_artifact["modelJson"])
    if algorithm == "catboost":
        from catboost import CatBoostClassifier

        model = CatBoostClassifier()
        model.load_model(model_path, format="json")
        return model
    if algorithm == "xgboost":
        import xgboost as xgb

        model = xgb.Booster()
        model.load_model(model_path)
        return model
    raise ValueError("Saved boosted-tree algorithm is unsupported.")


def predict_head(algorithm, head_artifact, features, class_count, directory):
    if head_artifact.get("kind") == "constant":
        probabilities = np.asarray(head_artifact["probabilities"], dtype=np.float64)
        if probabilities.shape != (class_count,):
            raise ValueError("A saved constant prediction does not match its class count.")
        return probabilities / max(float(probabilities.sum()), 1e-12)

    labels = np.asarray(head_artifact["classLabels"], dtype=np.int64)
    model = load_head_model(algorithm, head_artifact, directory)
    if algorithm == "catboost":
        raw = model.predict_proba(features)
    else:
        import xgboost as xgb

        raw = model.predict(xgb.DMatrix(features))
        if labels.size == 2:
            raw = np.column_stack((1.0 - raw, raw))
        else:
            raw = np.asarray(raw).reshape(1, -1)
    return full_probabilities(raw, labels, class_count)[0]


def predict(request):
    artifact = request["artifact"]
    algorithm = request["algorithm"]
    features = np.asarray(request["features"], dtype=np.float32).reshape(1, -1)
    features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
    if (
        artifact.get("version") != 3
        or artifact.get("algorithm") != algorithm
        or artifact.get("featureCount") != features.shape[1]
    ):
        raise ValueError("The saved boosted-tree artifact does not match this model or feature vector.")

    with tempfile.TemporaryDirectory() as directory:
        probabilities = {}
        for head_name, class_count in HEADS:
            head_artifact = artifact.get("heads", {}).get(head_name)
            if not isinstance(head_artifact, dict):
                raise ValueError("The saved boosted-tree artifact is missing a prediction head.")
            probabilities[head_name] = predict_head(
                algorithm,
                head_artifact,
                features,
                class_count,
                directory,
            )

    correct_scores = []
    for index, probability in enumerate(probabilities["correctScore"]):
        home_goals = index // 6
        away_goals = index % 6
        home_label = "5+" if home_goals == 5 else str(home_goals)
        away_label = "5+" if away_goals == 5 else str(away_goals)
        correct_scores.append({
            "scoreline": home_label + "-" + away_label,
            "probability": float(probability),
        })
    correct_scores.sort(key=lambda item: item["probability"], reverse=True)

    result = probabilities["result"]
    btts = probabilities["bothTeamsToScore"]
    over25 = probabilities["overUnder25"]
    over35 = probabilities["overUnder35"]
    return {
        "result": {"home": float(result[0]), "draw": float(result[1]), "away": float(result[2])},
        "bothTeamsToScore": {"no": float(btts[0]), "yes": float(btts[1])},
        "overUnder25": {"under": float(over25[0]), "over": float(over25[1])},
        "overUnder35": {"under": float(over35[0]), "over": float(over35[1])},
        "correctScoreTop": correct_scores[:5],
        "historyMatchCount": int(request["historyMatchCount"]),
        "verifiedOddsHistoryCount": int(request["verifiedOddsHistoryCount"]),
    }


def main():
    try:
        request = json.load(sys.stdin)
        if request.get("mode") == "train":
            emit({"type": "result", "result": train(request)})
        elif request.get("mode") == "predict":
            emit({"type": "result", "result": predict(request)})
        else:
            raise ValueError("Unknown boosted-tree worker operation.")
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "error": str(error)[:500]})
        sys.exit(1)


if __name__ == "__main__":
    main()
